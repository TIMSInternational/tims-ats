import { TRPCError } from '@trpc/server';
import type { AccessContext } from './types';

// Wave 2.5 slice 3 — per-entity scope policy registry (design doc F3). The ONE
// place that knows each recruitment entity's anchor relations. Routers compose
// the returned fragment as AND: [{organizationId...}, fragment, inputFilters] —
// NEVER object spread (CI check 13). organization/company → {} is the
// deploy-safety invariant: pre-seed prod grants are all org-equivalent, so this
// slice is behavior-neutral until seed-access --apply runs.

export type ScopedEntity =
  | 'vacancy'
  | 'candidate'
  | 'application'
  | 'interview'
  | 'offer'
  | 'assessmentAssignment';

type Fragment = Record<string, unknown>;

const ENTITIES: ReadonlySet<string> = new Set([
  'vacancy', 'candidate', 'application', 'interview', 'offer', 'assessmentAssignment',
]);

export async function scopeWhereFor(
  entity: ScopedEntity,
  access: AccessContext,
  userId: string,
): Promise<Fragment> {
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
  }
}
