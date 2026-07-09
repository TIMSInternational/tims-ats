import { db } from '@tims/db';
import { InvoiceStatus } from '@prisma/client';
import type { InvoiceLine } from '../services/ai-interview-billing';

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

// Slice 2b usage metering: aggregates AiAgentUsageLog rows for a set of agent
// slugs (filtered via the `agent` relation, since usage logs don't store a
// slug column directly) within a billing period. 'count' = row count
// (e.g. screenings run); 'durationMinutes' = summed latencyMs / 60000
// (e.g. voice-interview minutes).
export async function getModuleUsageQuantity(
  orgId: string,
  agentSlugs: string[],
  aggregate: 'count' | 'durationMinutes',
  periodStart: Date,
  periodEnd: Date,
): Promise<number> {
  const where = {
    organizationId: orgId,
    agent: { slug: { in: agentSlugs } },
    createdAt: { gte: periodStart, lte: periodEnd },
  };
  if (aggregate === 'count') {
    return db.aiAgentUsageLog.count({ where });
  }
  const agg = await db.aiAgentUsageLog.aggregate({ where, _sum: { latencyMs: true } });
  return (agg._sum.latencyMs ?? 0) / 60000;
}

// Slice 2b usage-invoice writes. `InvoiceStatus` is imported directly from
// `@prisma/client` (not via `@tims/db`'s re-export) so the enum stays a real
// runtime value in unit tests that mock only `@tims/db`'s `db` delegate.
// Mirrors `routers/platform/invoices.ts` createInvoice's nested
// `lineItems: { create: [...] }` shape (total = quantity*unitPrice,
// sortOrder = array index) but additionally sets `status: draft` and the
// billing period, which createInvoice does not.
export async function createDraftInvoice(args: {
  orgId: string;
  periodStart: Date;
  periodEnd: Date;
  subtotalUsd: number;
  lines: InvoiceLine[];
}): Promise<{ invoiceId: string; invoiceNumber: number }> {
  const created = await db.invoice.create({
    data: {
      organizationId: args.orgId,
      status: InvoiceStatus.draft,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      subtotal: args.subtotalUsd,
      amount: args.subtotalUsd,
      currency: 'USD',
      lineItems: {
        create: args.lines.map((li, i) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.quantity * li.unitPrice,
          sortOrder: i,
        })),
      },
    },
    select: { id: true, invoiceNumber: true },
  });
  return { invoiceId: created.id, invoiceNumber: created.invoiceNumber };
}

// Finds an existing draft usage invoice for the exact org+period, so callers
// can avoid double-creating one for the same billing period.
export async function findDraftInvoiceForPeriod(
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ id: string } | null> {
  return db.invoice.findFirst({
    where: {
      organizationId: orgId,
      status: InvoiceStatus.draft,
      periodStart,
      periodEnd,
    },
    select: { id: true },
  });
}
