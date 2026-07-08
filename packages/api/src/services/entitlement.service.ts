import { TRPCError } from '@trpc/server';
import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../lib/cache';
import { findEnabledEntitlements } from '../repositories/entitlement.repository';

// ---------------------------------------------------------------------------
// Entitlement resolver — cache-aside over org_entitlements. Router → Service →
// Repository: this file imports the repository + cache only, never `db`
// directly, and imports no tRPC types except TRPCError (thrown by
// requireEntitlement). Cache key: tims:entitlements:{orgId}, TTL 300s.
// ---------------------------------------------------------------------------

export type EffectiveEntitlement = { moduleCode: string; limit: number | null; unitPrice: number | null };

const TTL_SECONDS = 300;
const keyFor = (orgId: string) => `tims:entitlements:${orgId}`;

export async function getEntitlements(orgId: string): Promise<Map<string, EffectiveEntitlement>> {
  const cached = await cacheGet<EffectiveEntitlement[]>(keyFor(orgId));
  const rows = cached ?? (await findEnabledEntitlements(orgId));
  if (!cached) await cacheSet(keyFor(orgId), rows, TTL_SECONDS);
  return new Map(rows.map((r) => [r.moduleCode, r]));
}

export async function hasEntitlement(orgId: string, moduleCode: string): Promise<boolean> {
  return (await getEntitlements(orgId)).has(moduleCode);
}

export async function requireEntitlement(orgId: string, moduleCode: string): Promise<EffectiveEntitlement> {
  const ent = (await getEntitlements(orgId)).get(moduleCode);
  if (!ent) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `entitlement_missing:${moduleCode}` });
  }
  return ent;
}

// Meter-and-bill: over-limit returns overage=true; it NEVER blocks. null limit = unlimited.
export function checkLimit(limit: number | null, currentUsage: number, amount: number): { overage: boolean } {
  if (limit === null) return { overage: false };
  return { overage: currentUsage + amount > limit };
}

export async function invalidateEntitlementCache(orgId: string): Promise<void> {
  await cacheInvalidatePrefix(keyFor(orgId));
}
