import { TRPCError } from '@trpc/server';
import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../lib/cache';
import {
  findEnabledEntitlements,
  listModules,
  getOrgEntitlementRows,
  upsertOrgEntitlement,
  applyPlanToOrg,
  listPlans,
} from '../repositories/entitlement.repository';

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

// ---------------------------------------------------------------------------
// Admin console — platform-owner view/mutation of an org's entitlements.
// getOrgEntitlementsAdmin merges the full module catalog with the org's rows
// (every module appears, even ones the org has never touched). setOrgEntitlement
// resolves `source` only when enabling a row that doesn't yet have one (new
// row, or an existing row whose source was never set) — a limit/price-only
// patch on an already-sourced row leaves `source` untouched. Both mutation
// paths invalidate the 300s effective-entitlement cache so the runtime
// resolver (getEntitlements) picks up the change on the next read.
// ---------------------------------------------------------------------------

export type AdminEntitlement = {
  moduleCode: string;
  name: string;
  kind: string;
  metered: boolean;
  unit: string | null;
  enabled: boolean;
  source: string | null;
  limit: number | null;
  // Raw per-org override (null when the org has no override for this
  // module) — this is the editable value the admin UI must bind its
  // unit-price input's draft state to. Do NOT use `effectiveUnitPrice` for
  // that: it's the merged (override ?? catalog default) value, and
  // initializing an input's draft from it makes an untouched blur look
  // "unchanged" while actually committing the catalog default as a brand
  // new override, silently wiping the org's real override on next read.
  unitPrice: number | null;
  // Merged value (override ?? catalog default) — for display/billing hints
  // only (e.g. the input's placeholder), never for seeding editable state.
  effectiveUnitPrice: number | null;
};

export async function getOrgEntitlementsAdmin(orgId: string): Promise<AdminEntitlement[]> {
  const [modules, rows] = await Promise.all([listModules(), getOrgEntitlementRows(orgId)]);
  const byCode = new Map(rows.map((r) => [r.moduleCode, r]));
  return modules.map((m) => {
    const row = byCode.get(m.code);
    return {
      moduleCode: m.code,
      name: m.name,
      kind: m.kind,
      metered: m.metered,
      unit: m.unit,
      enabled: row?.enabled ?? false,
      source: row?.source ?? null,
      limit: row?.limit ?? null,
      unitPrice: row?.unitPrice ?? null,
      effectiveUnitPrice: row?.unitPrice ?? m.defaultUnitPrice,
    };
  });
}

export async function setOrgEntitlement(
  orgId: string,
  moduleCode: string,
  patch: { enabled?: boolean; limit?: number | null; unitPrice?: number | null },
): Promise<void> {
  // Fetch existing rows once: needed both to resolve `source` when
  // enabling, and to guard against implicitly granting access when a
  // limit/price-only patch would otherwise create a brand-new row.
  const rows = await getOrgEntitlementRows(orgId);
  const existing = rows.find((r) => r.moduleCode === moduleCode);

  // Resolve source only when creating/enabling a row that has no source yet.
  let source: string | undefined;
  if (patch.enabled === true && (!existing || existing.source == null)) {
    const modules = await listModules();
    const mod = modules.find((m) => m.code === moduleCode);
    source = mod?.kind === 'addon' ? 'addon' : 'override';
  }

  // Pass through only what the caller actually set: `patch` already omits
  // `enabled` unless the caller explicitly set it, so a limit/price-only
  // call sends no `enabled` key at all. That keeps the upsert's `update`
  // branch race-safe (no risk of stomping a concurrently-enabled row back
  // to disabled) while the repository's `create` branch defaults a
  // brand-new row's `enabled` to false — access is granted ONLY by an
  // explicit `enabled: true` in the patch, never implicitly.
  await upsertOrgEntitlement(orgId, moduleCode, {
    ...patch,
    ...(source ? { source } : {}),
  });
  await invalidateEntitlementCache(orgId);
}

export async function assignPlan(orgId: string, planCode: string): Promise<{ applied: number }> {
  const applied = await applyPlanToOrg(orgId, planCode);
  await invalidateEntitlementCache(orgId);
  return { applied };
}

// Thin catalog passthroughs so the admin router reads via the service layer
// (never importing the repository directly), per the repo's Router→Service→
// Repository rule.
export async function listPlansForAdmin() {
  return listPlans();
}

export async function listModulesForAdmin() {
  return listModules();
}
