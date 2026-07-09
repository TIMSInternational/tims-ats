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

// All org entitlement rows (including disabled) for the platform-owner admin
// console — contrast with findEnabledEntitlements above, which filters to
// enabled: true for the runtime resolver's effective-entitlement cache.
export async function getOrgEntitlementRows(orgId: string) {
  return db.orgEntitlement.findMany({
    where: { organizationId: orgId },
    select: { moduleCode: true, enabled: true, source: true, limit: true, unitPrice: true },
  });
}

export async function upsertOrgEntitlement(
  orgId: string,
  moduleCode: string,
  data: { enabled?: boolean; source?: string; limit?: number | null; unitPrice?: number | null },
): Promise<void> {
  await db.orgEntitlement.upsert({
    where: { organizationId_moduleCode: { organizationId: orgId, moduleCode } },
    update: data,
    // A create never implicitly grants access: default `enabled` to false
    // unless the caller passed an explicit `enabled` value. Access is
    // granted only via an explicit `enabled: true` in the service layer.
    create: {
      organizationId: orgId,
      moduleCode,
      enabled: data.enabled ?? false,
      source: data.source ?? 'override',
      limit: data.limit ?? null,
      unitPrice: data.unitPrice ?? null,
    },
  });
}

// Re-asserts a plan's baseline (enabled + plan limit, source 'plan') for each
// of its modules on the target org — a true baseline reset, matching the
// admin UI's confirm copy (entitlementsAdmin.applyPlanConfirm): any per-org
// unitPrice override is cleared back to null so the effective price falls
// back to the module catalog's default. Operator per-module overrides
// (limit, unitPrice, enabled) applied AFTER an apply-plan persist until the
// next apply-plan call.
export async function applyPlanToOrg(orgId: string, planCode: string): Promise<number> {
  const planModules = await db.planModule.findMany({
    where: { planCode },
    select: { moduleCode: true, limit: true },
  });
  await db.$transaction(async (tx) => {
    for (const pm of planModules) {
      await tx.orgEntitlement.upsert({
        where: { organizationId_moduleCode: { organizationId: orgId, moduleCode: pm.moduleCode } },
        update: { enabled: true, source: 'plan', limit: pm.limit, unitPrice: null },
        create: {
          organizationId: orgId,
          moduleCode: pm.moduleCode,
          enabled: true,
          source: 'plan',
          limit: pm.limit,
          unitPrice: null,
        },
      });
    }
  });
  return planModules.length;
}

export async function listPlans() {
  return db.plan.findMany({ select: { code: true, name: true, active: true }, orderBy: { code: 'asc' } });
}

export async function listModules() {
  return db.module.findMany({
    select: { code: true, name: true, kind: true, metered: true, unit: true, defaultUnitPrice: true },
    orderBy: { code: 'asc' },
  });
}

export async function organizationExists(orgId: string): Promise<boolean> {
  const org = await db.organization.findFirst({ where: { id: orgId }, select: { id: true } });
  return org !== null;
}
