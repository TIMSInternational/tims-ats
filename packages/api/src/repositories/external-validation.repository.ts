import { tenantDb } from '@tims/db';
import type { Prisma } from '@tims/db';

export async function getValidationForSubmit(organizationId: string, validationId: string) {
  return tenantDb.preemploymentValidation.findFirst({
    where: { id: validationId, organizationId },
    select: { id: true, status: true },
  });
}

/**
 * Atomic pending-only write. `updateMany` with a status:'pending' guard is the
 * TOCTOU-safe transition — count 0 means the row is gone / not this org / already
 * finalized (caller maps to CONFLICT/NOT_FOUND). Sets vendor provenance, never a
 * staff completedById.
 */
export async function submitValidationResult(
  organizationId: string,
  validationId: string,
  apiKeyId: string,
  data: { status: 'passed' | 'failed'; result: Record<string, unknown>; notes?: string },
): Promise<{ count: number; completedAt: Date }> {
  const completedAt = new Date();
  const res = await tenantDb.preemploymentValidation.updateMany({
    where: { id: validationId, organizationId, status: 'pending' },
    data: {
      status: data.status,
      result: data.result as Prisma.InputJsonValue,
      notes: data.notes ?? undefined,
      completedByApiKeyId: apiKeyId,
      completedById: null,
      completedAt,
    },
  });
  return { count: res.count, completedAt };
}
