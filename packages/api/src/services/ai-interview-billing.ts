// packages/api/src/services/ai-interview-billing.ts
// Pure billing math for the AI Voice Interview add-on. No db, no i18n —
// labels are passed in by callers (the platform query localizes).

/** A line shaped for platform.createInvoice's lineItems[] input. */
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Round a USD amount UP to the nearest cent, collapsing sub-1e-10 IEEE-754
 * noise first (e.g. 0.10+0.20 → 0.30000000000000004; toFixed(10) snaps it
 * back to 0.3000000000 before ceil, giving 0.30 not 0.31).
 */
function ceilUsd(value: number): number {
  return Math.ceil(parseFloat((value * 100).toFixed(10))) / 100;
}

/**
 * Billable USD for one interview: per-second prorated at the org's
 * billableUsdPerMinute, rounded UP to 2 decimals. 0 when unpriced/empty.
 */
export function computeInterviewBillableUsd(
  durationSeconds: number,
  billableUsdPerMinute: number | null,
): number {
  if (billableUsdPerMinute === null || billableUsdPerMinute <= 0) return 0;
  if (durationSeconds <= 0) return 0;
  return ceilUsd((durationSeconds / 60) * billableUsdPerMinute);
}

/**
 * Build the invoice lines for an org's add-on fee + accrued usage in a period.
 * Add-on line first. Empty array when neither applies. Quantity is always 1
 * (unitPrice carries the amount) to satisfy createInvoice's positive-int rule.
 */
export function buildAiInterviewInvoiceLines(args: {
  addonMonthlyFeeUsd: number | null;
  usageUsd: number;
  addonLabel: string;
  usageLabel: string;
}): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  if (args.addonMonthlyFeeUsd !== null && args.addonMonthlyFeeUsd > 0) {
    lines.push({ description: args.addonLabel, quantity: 1, unitPrice: args.addonMonthlyFeeUsd });
  }
  if (args.usageUsd > 0) {
    lines.push({ description: args.usageLabel, quantity: 1, unitPrice: ceilUsd(args.usageUsd) });
  }
  return lines;
}
