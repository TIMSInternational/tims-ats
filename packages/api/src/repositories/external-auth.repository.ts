import { db } from '@tims/db';
import { activeApiKeyWhere } from '../lib/api-key';

/** The minimal shape the auth path needs from a key row. NEVER includes keyHash. */
export interface ActiveApiKeyRow {
  id: string;
  organizationId: string;
  scopes: unknown; // Json column — narrowed by the caller to string[]
}

/**
 * Resolve an ACTIVE key by its hash on the PRIVILEGED db (pre-tenant-context).
 * Returns null when no active key matches (missing/expired/revoked) — the caller
 * fails closed. Selects only the principal fields; never returns the hash.
 *
 * Also fails closed if the owning Organization is suspended (isActive=false) or
 * soft-deleted (deletedAt≠null) — a suspended tenant's keys must immediately stop
 * exporting data without needing each key individually revoked.
 */
export async function findActiveApiKeyByHash(
  keyHash: string,
  now: Date,
): Promise<ActiveApiKeyRow | null> {
  const key = await db.apiKey.findFirst({
    where: activeApiKeyWhere(keyHash, now),
    select: { id: true, organizationId: true, scopes: true },
  });
  if (!key) return null;
  // Fail closed if the owning tenant is suspended/deleted — a suspended org's keys
  // must immediately stop exporting data, without needing each key revoked.
  const org = await db.organization.findFirst({
    where: { id: key.organizationId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!org) return null;
  return key;
}

/**
 * Record last-used. Fire-and-forget on the privileged db: a failure here must
 * never block (or alter the timing of) the authenticated request.
 */
export function touchApiKeyLastUsed(id: string): void {
  db.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => {});
}
