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

const NOT_FOUND_MESSAGES: Record<ScopedEntity, string> = {
  vacancy: 'Vacante no encontrada',
  candidate: 'Candidato no encontrado',
  application: 'Aplicacion no encontrada',
  interview: 'Entrevista no encontrada',
  offer: 'Oferta no encontrada',
  assessmentAssignment: 'Asignacion no encontrada',
};

const DELEGATES = {
  vacancy: () => tenantDb.vacancy,
  candidate: () => tenantDb.candidate,
  application: () => tenantDb.application,
  interview: () => tenantDb.interview,
  offer: () => tenantDb.offer,
  assessmentAssignment: () => tenantDb.assessmentAssignment,
} as const;

export async function assertScoped(
  entity: ScopedEntity,
  id: string,
  access: AccessContext,
  userId: string,
  organizationId: string,
): Promise<void> {
  const fragment = await scopeWhereFor(entity, access, userId);
  const delegate = DELEGATES[entity]() as { findFirst: (args: unknown) => Promise<unknown> };
  const conditions: unknown[] = [{ id }, { organizationId }];
  if (SOFT_DELETABLE.has(entity)) conditions.push({ deletedAt: null });
  conditions.push(fragment);
  const row = await delegate.findFirst({ where: { AND: conditions }, select: { id: true } });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: NOT_FOUND_MESSAGES[entity] });
  }
}
