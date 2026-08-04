import { TRPCError } from '@trpc/server';
import type { AccessContext } from './types';

// Wave 2.5 slice 3 — per-entity scope policy registry (design doc F3). The ONE
// place that knows each recruitment entity's anchor relations. Routers compose
// the returned fragment as AND: [{organizationId...}, fragment, inputFilters] —
// NEVER object spread (CI check 13). organization/company → {} is the
// deploy-safety invariant: pre-seed prod grants are all org-equivalent, so this
// slice is behavior-neutral until seed-access --apply runs.

// ONE source of truth (#132, 2026-08-04). This list previously existed THREE times — as a `ScopedEntity`
// union, as this runtime `ENTITIES` set, and as the case labels below — with nothing keeping them in
// agreement. Now the type is DERIVED from the array, so union/set drift is impossible by construction.
// Verified behaviour-neutral at the point of the change: union, set and the
// contracts/access-fixtures/scope-where.json entity set were all exactly these 21 names.
//
// Adding an entity here without a `case` below is a compile error (the switch is exhaustive over the
// union). Adding one without a fixture case fails tests/governance/scope-fixtures.test.ts.
export const SCOPED_ENTITIES = [
  'vacancy',
  'candidate',
  'application',
  'interview',
  'offer',
  'assessmentAssignment',
  'okr',
  'coachingSession',
  'feedback',
  'onboardingPlan',
  'enrollment',
  'certificate',
  'nineBoxEvaluation',
  'successor',
  'criticalRole',
  'employeeCompensation',
  'salaryAdjustment',
  'team',
  'actionPlan',
  'leaderCommitment',
  'commitment',
] as const;

export type ScopedEntity = (typeof SCOPED_ENTITIES)[number];

type Fragment = Record<string, unknown>;

const ENTITIES: ReadonlySet<string> = new Set(SCOPED_ENTITIES);

export async function scopeWhereFor(entity: ScopedEntity, access: AccessContext, userId: string): Promise<Fragment> {
  if (!ENTITIES.has(entity)) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Entidad sin politica de alcance: ${entity}` });
  }
  const { scope, anchors } = access;

  if (scope === 'organization' || scope === 'company') return {};

  if (scope !== 'own' && scope !== 'team' && scope !== 'unit') {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Alcance desconocido: ${String(scope)}` });
  }
  if (!anchors) {
    // Narrow scope but no anchor loader (org-less user) — fail closed, never unscoped.
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Sin contexto de organizacion para alcance restringido' });
  }

  const vacancyFragment: Fragment =
    scope === 'team'
      ? { OR: [{ teamId: { in: await anchors.ledTeamIds() } }, { assignedTo: userId }] }
      : scope === 'unit'
        ? { businessUnitId: { in: await anchors.unitIds() } }
        : { OR: [{ assignedTo: userId }, { createdBy: userId }] }; // own

  // Codex F5: NESTED uses (a `vacancy` relation filter on candidate/application/
  // interview/offer/assessmentAssignment) must exclude soft-deleted vacancies —
  // otherwise a narrow scope can anchor visibility through a deleted vacancy.
  // The BARE vacancy entity fragment must NOT carry deletedAt: vacancy queries
  // add their own deletedAt in base conditions and the probe adds it via
  // SOFT_DELETABLE. At org/company scope this never runs ({} early-return above).
  const viaVacancy: Fragment = { vacancy: { AND: [vacancyFragment, { deletedAt: null }] } };

  // People entities anchor on the row's EMPLOYEE-user field. The subject set per
  // scope: own → [userId] (emitted as a SCALAR, not an `in`); team →
  // teamMemberIds (floors to [self]); unit → unitMemberIds (floors to []).
  const subjectFragment = async (): Promise<unknown> => {
    if (scope === 'own') return userId; // scalar equality
    if (scope === 'team') return { in: await anchors.teamMemberIds() };
    return { in: await anchors.unitMemberIds() }; // unit
  };

  switch (entity) {
    case 'vacancy':
      return vacancyFragment;
    case 'candidate':
      // No direct anchor on Candidate — visibility flows from the vacancies the
      // user can see, via that candidate's applications.
      return { applications: { some: viaVacancy } };
    case 'interview':
      // Panel arm: an assigned evaluator (committee) sees their interviews
      // regardless of team; a leader sees team-vacancy interviews (design gap #5).
      return scope === 'own'
        ? { evaluators: { some: { userId } } }
        : { OR: [viaVacancy, { evaluators: { some: { userId } } }] };
    case 'application':
    case 'offer':
    case 'assessmentAssignment':
      return viaVacancy;
    // --- People entities (Wave 2.5 slice 4) ---------------------------------
    case 'okr':
    case 'enrollment':
    case 'certificate':
    case 'nineBoxEvaluation':
    case 'successor':
    case 'employeeCompensation':
    case 'salaryAdjustment':
      return { userId: await subjectFragment() };
    case 'coachingSession':
      // Subject = the coached employee; the coach (leaderId) always sees their
      // own sessions regardless of scope.
      return { OR: [{ employeeId: await subjectFragment() }, { leaderId: userId }] };
    case 'commitment':
      // Subject = the committed employee; the creator (coach) always sees
      // commitments they created regardless of scope.
      return { OR: [{ employeeId: await subjectFragment() }, { createdById: userId }] };
    case 'feedback':
      // Subject = the recipient (toUserId); the giver (fromUserId) always sees
      // feedback they authored.
      return { OR: [{ toUserId: await subjectFragment() }, { fromUserId: userId }] };
    case 'onboardingPlan':
      // Subject = the new hire (userId); the assigned buddy always sees the plan.
      return { OR: [{ userId: await subjectFragment() }, { buddyId: userId }] };
    case 'criticalRole':
      // Anchored on the (nullable) current holder. Prisma `in` never matches
      // NULL → an unfilled critical role is hidden from narrow scopes (fail-narrow).
      return { currentHolderId: await subjectFragment() };
    case 'team':
      // Teams the user leads (team/own) or the teams of their assigned units (unit).
      return scope === 'unit'
        ? { businessUnitId: { in: await anchors.unitIds() } }
        : { id: { in: await anchors.ledTeamIds() } };
    case 'actionPlan':
      // ActionPlan anchors on responsibleId (the person responsible for the plan).
      // own → scalar equality; team/unit → subject set via the people anchor.
      return { responsibleId: await subjectFragment() };
    case 'leaderCommitment':
      // ActionPlan anchors on leaderId (the person responsible for the plan).
      // own → scalar equality; team/unit → subject set via the people anchor.
      return { leaderId: await subjectFragment() };
  }
}
