import { TRPCError } from '@trpc/server';
import { tenantDb } from '@tims/db';
import { scopeWhereFor } from './entity-policies';
import type { ScopedEntity } from './entity-policies';
import type { AccessContext } from './types';

// Ownership probe for by-id mutations (design invariant #3): a narrow-scoped
// user must not reach an out-of-scope row by id-guessing. NOT_FOUND (not
// FORBIDDEN) so the response doesn't confirm the id exists.

// Vacancy and Candidate are the only soft-deletable scoped entities (schema
// fact — the other four have no deletedAt column). The probe must preserve the
// soft-delete guard the org-check findFirsts it replaces carried.
const SOFT_DELETABLE: ReadonlySet<ScopedEntity> = new Set(['vacancy', 'candidate'] as const);

// Entities whose table was ownership-flipped to `efcore` — their Prisma model is deleted, so there is
// no `tenantDb` delegate to probe from TypeScript. They REMAIN valid `ScopedEntity` values on purpose:
// `scopeWhereFor` is a pure function over the shared cross-stack contract
// (`contracts/access-fixtures/scope-where.json`, asserted by both this stack and Tims.UnitTests'
// ScopeWhereForFixtureTests), and C# still probes both roots via ScopeProbeRegistry. Only the by-id
// PROBE — which needs a live Prisma delegate — is unavailable here.
//
// #69 (2026-08-04): successor + criticalRole. The C# equivalents are
// SuccessionWriteEndpointAuthTests.RemoveSuccessor_Leader_OutOfScope_Is404 /
// UpdateReadiness_Leader_OutOfScope_Is404 and SuccessionReadTests.TeamScope_OutOfScopeRole_Is404_IdorProbe.
type FlippedEntity = 'successor' | 'criticalRole';

/** A `ScopedEntity` that still has a Prisma delegate, so `assertScoped` can probe it. Calling
 *  `assertScoped` with a flipped entity is a COMPILE error rather than a runtime `undefined` delegate. */
export type ProbeableEntity = Exclude<ScopedEntity, FlippedEntity>;

const NOT_FOUND_MESSAGES: Record<ScopedEntity, string> = {
  vacancy: 'Vacante no encontrada',
  candidate: 'Candidato no encontrado',
  application: 'Aplicacion no encontrada',
  interview: 'Entrevista no encontrada',
  offer: 'Oferta no encontrada',
  assessmentAssignment: 'Asignacion no encontrada',
  // People entities (Wave 2.5 slice 4) — match existing router messages where present.
  okr: 'OKR no encontrado',
  coachingSession: 'Sesion de coaching no encontrada',
  feedback: 'Feedback no encontrado',
  onboardingPlan: 'Plan de onboarding no encontrado',
  enrollment: 'Inscripcion no encontrada',
  certificate: 'Certificado no encontrado',
  nineBoxEvaluation: 'Evaluacion no encontrada',
  successor: 'Sucesor no encontrado',
  criticalRole: 'Rol critico no encontrado',
  employeeCompensation: 'Compensacion no encontrada',
  salaryAdjustment: 'Ajuste salarial no encontrado',
  team: 'Equipo no encontrado',
  actionPlan: 'Plan de accion no encontrado',
  leaderCommitment: 'Compromiso no encontrado',
  commitment: 'Compromiso no encontrado',
};

// Explicitly annotated (not a bare `as const`) so the exhaustiveness claim below is real: omitting a
// ProbeableEntity is a compile error, and leaving a flipped entity in is one too.
const DELEGATES: Record<ProbeableEntity, () => unknown> = {
  vacancy: () => tenantDb.vacancy,
  candidate: () => tenantDb.candidate,
  application: () => tenantDb.application,
  interview: () => tenantDb.interview,
  offer: () => tenantDb.offer,
  assessmentAssignment: () => tenantDb.assessmentAssignment,
  okr: () => tenantDb.okr,
  coachingSession: () => tenantDb.coachingSession,
  feedback: () => tenantDb.feedback,
  onboardingPlan: () => tenantDb.onboardingPlan,
  enrollment: () => tenantDb.enrollment,
  certificate: () => tenantDb.certificate,
  nineBoxEvaluation: () => tenantDb.nineBoxEvaluation,
  // successor + criticalRole intentionally ABSENT — ownership-flipped to `efcore` (#69), Prisma models
  // deleted. `DELEGATES` is keyed on ProbeableEntity, so this map stays exhaustive and a future flip
  // that forgets to widen FlippedEntity fails to compile here.
  employeeCompensation: () => tenantDb.employeeCompensation,
  salaryAdjustment: () => tenantDb.salaryAdjustment,
  team: () => tenantDb.team,
  actionPlan: () => tenantDb.actionPlan,
  leaderCommitment: () => tenantDb.leaderCommitment,
  commitment: () => tenantDb.commitment,
} as const;

export async function assertScoped(
  // ProbeableEntity, not ScopedEntity: a by-id probe needs a live Prisma delegate, so a flipped entity
  // ('successor'/'criticalRole') is rejected at COMPILE time. Their probes live in C# now — see
  // FlippedEntity above.
  entity: ProbeableEntity,
  id: string,
  access: AccessContext,
  userId: string,
  organizationId: string,
): Promise<void> {
  const fragment = await scopeWhereFor(entity, access, userId);
  // BELT AND BRACES, and deliberately not redundant. The parameter type covers every call site the
  // compiler can see — including one holding a widened `ScopedEntity`, which is correctly rejected. What
  // it does NOT cover: an `any`, an explicit cast, or a JS caller. (A plain `string` IS rejected — an
  // earlier version of this comment claimed otherwise.) Any of those reaches `DELEGATES[entity]()` with
  // `undefined` and throws a bare `TypeError: ... is not a function` → an opaque 500. Worse,
  // NOT_FOUND_MESSAGES still carries entries for the flipped entities (on purpose — those strings mirror
  // ScopedNotFoundException.cs), so the code reads as though it supports them right up to this lookup.
  // Fail with something that names the cause instead.
  const factory = DELEGATES[entity as ProbeableEntity] as (() => unknown) | undefined;
  if (typeof factory !== 'function') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message:
        `assertScoped('${String(entity)}') has no Prisma delegate: that table was ownership-flipped to ` +
        `EF Core, so it cannot be probed from TypeScript. Probe it via the C# API instead.`,
    });
  }
  const delegate = factory() as { findFirst: (args: unknown) => Promise<unknown> };
  const conditions: unknown[] = [{ id }, { organizationId }];
  if (SOFT_DELETABLE.has(entity)) conditions.push({ deletedAt: null });
  conditions.push(fragment);
  const row = await delegate.findFirst({ where: { AND: conditions }, select: { id: true } });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: NOT_FOUND_MESSAGES[entity] });
  }
}
