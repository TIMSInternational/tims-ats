// packages/api/src/services/usage-billing.service.ts
// Slice 2b — usage billing computation + invoice-line shaping.
// Pure orchestration over the entitlement + usage-metering layers: no db,
// no Prisma. Billing price ALWAYS comes from entitlement.service's
// `effectiveUnitPrice` (override ?? catalog default) — never from
// AiAgentOrgConfig.billableUsdPerMinute or the stored aiAgentUsageLog.billableUsd.

import { getOrgEntitlementsAdmin } from './entitlement.service';
import { getModuleUsage, METERED_MODULE_USAGE } from './usage-metering.service';
import { ceilUsd, type InvoiceLine } from './ai-interview-billing';
import { createDraftInvoice } from '../repositories/entitlement.repository';

export type UsageLine = {
  moduleCode: string;
  name: string;
  unit: string;
  quantity: number;
  includedQty: number;
  billableQty: number;
  unitPrice: number;
  amountUsd: number;
};

export type UsageBillingPreview = { lines: UsageLine[]; subtotalUsd: number };

/**
 * Compute a usage-billing preview for one org + period. Iterates the org's
 * admin entitlements, skips anything disabled / non-metered / not in
 * METERED_MODULE_USAGE, then for each remaining module pulls actual usage
 * and applies the overage rule: unlimited (limit === null) modules bill
 * every unit; limited modules bill only the quantity above the limit.
 */
export async function computeUsageBilling(
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<UsageBillingPreview> {
  const entitlements = await getOrgEntitlementsAdmin(orgId);
  const lines: UsageLine[] = [];

  for (const e of entitlements) {
    if (!e.enabled || !e.metered || !METERED_MODULE_USAGE[e.moduleCode]) continue;

    const usage = await getModuleUsage(orgId, e.moduleCode, periodStart, periodEnd);
    if (!usage) continue;

    const quantity = usage.quantity;
    const includedQty = e.limit ?? 0;
    const billableQty = e.limit == null ? quantity : Math.max(0, quantity - e.limit);
    const unitPrice = e.effectiveUnitPrice ?? 0;
    const amountUsd = ceilUsd(billableQty * unitPrice);

    lines.push({
      moduleCode: e.moduleCode,
      name: e.name,
      unit: usage.unit,
      quantity,
      includedQty,
      billableQty,
      unitPrice,
      amountUsd,
    });
  }

  const subtotalUsd = ceilUsd(lines.reduce((sum, l) => sum + l.amountUsd, 0));
  return { lines, subtotalUsd };
}

/**
 * Shape a UsageBillingPreview into invoice lines. Zero-amount lines are
 * dropped (nothing to bill). Quantity is always 1 — unitPrice carries the
 * full computed amount, matching the ai-interview-billing InvoiceLine
 * convention (createInvoice's positive-int quantity rule).
 */
export function buildUsageInvoiceLines(preview: UsageBillingPreview): InvoiceLine[] {
  return preview.lines
    .filter((l) => l.amountUsd > 0)
    .map((l) => ({
      description: `${l.name}: ${l.billableQty} ${l.unit} × $${l.unitPrice} (${l.includedQty} incl.)`,
      quantity: 1,
      unitPrice: l.amountUsd,
    }));
}

/**
 * Orchestrates a draft usage invoice: shapes the preview into invoice lines
 * (buildUsageInvoiceLines) then persists a draft Invoice + nested line items
 * via the repository. No db import here — the repository owns that.
 */
export async function createUsageInvoice(
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
  preview: UsageBillingPreview,
): Promise<{ invoiceId: string; invoiceNumber: number }> {
  const lines = buildUsageInvoiceLines(preview);
  return createDraftInvoice({
    orgId,
    periodStart,
    periodEnd,
    subtotalUsd: preview.subtotalUsd,
    lines,
  });
}
