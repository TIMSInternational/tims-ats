import { db } from '@tims/db';

// The effective per-module unit price: the org's own OrgEntitlement.unitPrice
// override when set, else the module catalog's Module.defaultUnitPrice. The
// raw org row's unitPrice is null for any plan-sourced module without an
// explicit per-company override (e.g. ai_screening, whose catalog default is
// 0.5) — returning it as-is would silently report "no price" for a metered,
// billable module. Flattened to {moduleCode, limit, unitPrice} so the 300s
// entitlement cache shape (EffectiveEntitlement) is unchanged.
export async function findEnabledEntitlements(
  orgId: string,
): Promise<Array<{ moduleCode: string; limit: number | null; unitPrice: number | null }>> {
  const rows = await db.orgEntitlement.findMany({
    where: { organizationId: orgId, enabled: true },
    select: {
      moduleCode: true,
      limit: true,
      unitPrice: true,
      module: { select: { defaultUnitPrice: true } },
    },
  });
  return rows.map((row) => ({
    moduleCode: row.moduleCode,
    limit: row.limit,
    unitPrice: row.unitPrice ?? row.module.defaultUnitPrice,
  }));
}
