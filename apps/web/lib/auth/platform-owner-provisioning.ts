// First-sign-in provisioning of a platform owner, atomic with the allowlist check (platform-owner
// access-2). Shared by the tRPC context builder and the auth callback. The allowlist read and the owner
// insert run in one transaction behind the same advisory lock platform.removePlatformOwnerEmail takes, so a
// removal either sees (and revokes) the new owner or makes this sign-in find the address gone.
//
// Deliberately no `server-only` import, like staff-context.ts, so vitest can load it; it is only imported
// by server route handlers.

import { db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { platformOwnerEmailLockKey } from '@tims/shared';

/**
 * Runs `create` only while `email` is on the owner allowlist, inside the allowlist's lock. Returns what
 * `create` returned, or null when the address is not (or no longer) listed.
 */
export async function provisionPlatformOwner<T>(
  email: string,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${platformOwnerEmailLockKey(email)}, 0))`;
    const entry = await tx.platformOwnerEmail.findUnique({ where: { email }, select: { email: true } });
    if (!entry) return null;
    return create(tx);
  });
}
