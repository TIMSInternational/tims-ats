import { tenantDb } from '@tims/db';
import type { Prisma } from '@tims/db';
import type { AccessContext } from '../access/types';
import { scopeWhereFor } from '../access/entity-policies';
import { selectFor } from '../access/select-for';
import type { ExternalResultRow } from '../dto/external-assessment';

// Minimal assignment context the v1 DTO needs (lifecycle + identity). Assignment rows
// are not classification-sensitive; these are non-psychometric anchors.
const ASSIGNMENT_SELECT = {
  candidateId: true,
  vacancyId: true,
  status: true,
  assignedAt: true,
  startedAt: true,
  completedAt: true,
  expiresAt: true,
  assessmentType: { select: { name: true } },
} as const;

// Result-field projection comes from the classification ceiling for `external`.
function resultSelect() {
  return {
    ...selectFor(['external'], 'assessmentResult'),
    // scoredAt is a non-sensitive lifecycle timestamp the v1 DTO needs; selectFor's
    // classification ceiling does not include it (it's neither an anchor nor a scored
    // field), so add it explicitly here. Do NOT add it to the shared anchor list —
    // that would change selectFor for every other assessmentResult caller.
    scoredAt: true,
    assignment: { select: ASSIGNMENT_SELECT },
  };
}

// AssessmentResult.assignment is a required (non-nullable) to-one relation — Prisma
// exposes it as XOR<ScalarRelationFilter, WhereInput>. The `is:` arm of
// ScalarRelationFilter lets us filter on the parent assignment's fields without
// spreading unknown Fragment keys into a typed input. scopeWhereFor at org/company
// scope returns {} (no-op); at narrower scopes it returns vacancy-anchored
// fragments — cast to Prisma.AssessmentAssignmentWhereInput to satisfy tsc without
// any. Only COMPLETED assignments whose result is already scored are exposed.
// Defense-in-depth: explicit organizationId on both the result row AND the joined
// assignment — RLS is the secondary backstop per api-security.md §Multi-Tenancy.
export async function listExternalResults(
  access: AccessContext,
  organizationId: string,
  principalId: string,
  take: number,
  cursor?: string,
): Promise<{ rows: ExternalResultRow[]; nextCursor?: string }> {
  const scope = await scopeWhereFor('assessmentAssignment', access, principalId);
  const where = {
    AND: [
      { organizationId },
      {
        assignment: {
          is: {
            organizationId,
            status: 'completed',
            AND: [scope as Prisma.AssessmentAssignmentWhereInput],
          },
        },
      },
    ],
  };
  const items = await tenantDb.assessmentResult.findMany({
    where,
    select: resultSelect(),
    take: take + 1,
    ...(cursor ? { cursor: { assignmentId: cursor }, skip: 1 } : {}),
    orderBy: [{ scoredAt: 'desc' }, { assignmentId: 'asc' }],
  });
  const hasMore = items.length > take;
  const rows = items.slice(0, take) as unknown as ExternalResultRow[];
  return { rows, nextCursor: hasMore ? rows[take - 1]?.assignmentId : undefined };
}

// Single-fetch now matches the list: result-gated AND completed-only. A non-completed
// assignment (assigned/in_progress/cancelled) returns null → NOT_FOUND at the service.
// Previously this was status-agnostic, which allowed a scored result on a non-completed
// assignment to be returned by a by-id fetch — leaking restricted scores outside the
// lifecycle gate that listExternalResults enforces.
export async function getExternalResult(
  access: AccessContext,
  organizationId: string,
  principalId: string,
  assignmentId: string,
): Promise<ExternalResultRow | null> {
  const scope = await scopeWhereFor('assessmentAssignment', access, principalId);
  const row = await tenantDb.assessmentResult.findFirst({
    where: {
      AND: [
        { assignmentId },
        { organizationId },
        {
          assignment: {
            is: {
              organizationId,
              status: 'completed',
              AND: [scope as Prisma.AssessmentAssignmentWhereInput],
            },
          },
        },
      ],
    },
    select: resultSelect(),
  });
  return (row as unknown as ExternalResultRow) ?? null;
}
