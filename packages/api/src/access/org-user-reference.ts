import { TRPCError } from '@trpc/server';
import { tenantDb } from '@tims/db';

/** Reject user references outside the request tenant before a related row is written. */
export async function assertUsersInOrg(organizationId: string, userIds: readonly string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;

  const count = await tenantDb.user.count({
    where: { id: { in: ids }, organizationId, isActive: true, deletedAt: null },
  });
  if (count !== ids.length) {
    // The same response covers foreign, inactive, deleted, and nonexistent ids.
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario referenciado no encontrado en esta organizacion' });
  }
}
