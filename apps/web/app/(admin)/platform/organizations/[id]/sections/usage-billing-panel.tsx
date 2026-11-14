'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { formatCurrency } from '../../../../../../lib/format-utils';
import { Button, ConfirmDialog, EmptyState, ErrorState, Skeleton, inputClasses } from '../../../../../../components';
import type { UsageBillingLine } from '../../../../../../lib/trpc-types';

const emptyIcon = (
  <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 14l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const fmtCurrency = (value: number): string => formatCurrency(value, 'USD', 2);
const TH = 'px-4 py-2.5 text-callout font-semibold text-secondary';

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// `type=date` inputs report an empty string while the user is mid-edit
// (backspacing a segment) — parsing that would produce an Invalid Date, so
// we keep the raw string as source of truth and only derive a Date once it
// parses to a valid one.
function fromDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

// The backend filters usage with `createdAt <= periodEnd`, so a `periodEnd`
// built at local midnight (e.g. picking July 31 → 2026-07-31T00:00) excludes
// almost all of that day's usage and underbills. Parse the same local
// year/month/day components as `fromDateInputValue`, but pin the time to the
// last instant of the day so the picked end date is fully included.
function toPeriodEnd(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Extracted from billing-section.tsx (Slice 2b, Task 5) to keep the parent
// under the 300-line component limit. Preview + generate-draft-invoice
// console for the org's metered usage over an admin-picked period.
export function UsageBillingPanel({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [periodStartInput, setPeriodStartInput] = useState<string>(() => toDateInputValue(startOfCurrentMonth()));
  const [periodEndInput, setPeriodEndInput] = useState<string>(() => toDateInputValue(new Date()));

  const periodStart = fromDateInputValue(periodStartInput);
  const periodEnd = toPeriodEnd(periodEndInput);
  const hasValidPeriod = periodStart !== null && periodEnd !== null;

  const preview = trpc.platform.getUsageBillingPreview.useQuery(
    { orgId, periodStart: periodStart ?? undefined, periodEnd: periodEnd ?? undefined },
    { enabled: hasValidPeriod },
  );

  const generateInvoice = trpc.platform.generateUsageInvoice.useMutation({
    onSuccess: () => {
      utils.platform.getOrgInvoices.invalidate({ organizationId: orgId });
      toast(t.usageBilling.generated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const lines: UsageBillingLine[] = preview.data?.lines ?? [];
  const subtotalUsd = preview.data?.subtotalUsd ?? 0;

  const [confirming, setConfirming] = useState(false);
  const handleGenerate = () => {
    if (!periodStart || !periodEnd) return;
    setConfirming(false);
    generateInvoice.mutate({ orgId, periodStart, periodEnd });
  };
  const nothingBillable = hasValidPeriod && !preview.isLoading && (lines.length === 0 || subtotalUsd <= 0);
  const u = t.usageBilling;

  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-card" aria-labelledby="usage-billing-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <h2 id="usage-billing-title" className="text-subheading font-semibold text-primary">{u.title}</h2>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <fieldset className="grid w-full grid-cols-2 gap-2 sm:w-auto">
            <legend className="mb-1 text-callout font-medium text-secondary">{u.periodLabel}</legend>
            <label className="block">
              <span className="sr-only">{u.periodFrom}</span>
              <input
                type="date"
                value={periodStartInput}
                onChange={(e) => setPeriodStartInput(e.target.value)}
                disabled={generateInvoice.isPending}
                className={inputClasses('md')}
              />
            </label>
            <label className="block">
              <span className="sr-only">{u.periodTo}</span>
              <input
                type="date"
                value={periodEndInput}
                onChange={(e) => setPeriodEndInput(e.target.value)}
                disabled={generateInvoice.isPending}
                className={inputClasses('md')}
              />
            </label>
          </fieldset>
          <div className="w-full sm:w-auto">
            <Button
              fullWidth
              className="sm:w-auto"
              onClick={() => setConfirming(true)}
              loading={generateInvoice.isPending}
              disabled={!hasValidPeriod || nothingBillable}
              aria-describedby={nothingBillable ? 'usage-billing-disabled' : undefined}
            >
              {u.generate}
            </Button>
          </div>
          {nothingBillable && (
            <p id="usage-billing-disabled" className="w-full text-callout text-secondary sm:text-right">{u.noUsage}</p>
          )}
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title={u.generateConfirmTitle}
          description={u.generateConfirmBody}
          confirmLabel={u.generateConfirmBtn}
          onConfirm={handleGenerate}
          onCancel={() => setConfirming(false)}
        />
      )}

      {!hasValidPeriod ? (
        <EmptyState icon={emptyIcon} size="compact" message={t.usageBilling.emptyPeriod} />
      ) : preview.isLoading ? (
        <div className="space-y-3 p-5" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-3 w-32" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : preview.isError ? (
        <ErrorState onRetry={() => preview.refetch()} error={preview.error} size="compact" />
      ) : lines.length === 0 ? (
        <EmptyState icon={emptyIcon} size="compact" message={t.usageBilling.noUsage} />
      ) : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left">
          <caption className="sr-only">{u.title}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={TH}>{u.moduleCol}</th>
              <th scope="col" className={`${TH} text-right`}>{u.usageCol}</th>
              <th scope="col" className={`${TH} text-right`}>{u.includedCol}</th>
              <th scope="col" className={`${TH} text-right`}>{u.billableCol}</th>
              <th scope="col" className={`${TH} text-right`}>{u.unitPriceCol}</th>
              <th scope="col" className={`${TH} text-right`}>{u.amountCol}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.moduleCode} className="hover:bg-surface-hover">
                <td className="px-4 py-2.5 text-body font-medium text-primary">{line.name}</td>
                <td className="px-4 py-2.5 text-right text-callout tabular-nums text-secondary">{line.quantity} {line.unit}</td>
                <td className="px-4 py-2.5 text-right text-callout tabular-nums text-secondary">{line.includedQty}</td>
                <td className="px-4 py-2.5 text-right text-callout tabular-nums text-secondary">{line.billableQty}</td>
                <td className="px-4 py-2.5 text-right text-callout tabular-nums text-secondary">{fmtCurrency(line.unitPrice)}</td>
                <td className="px-4 py-2.5 text-right text-body font-medium tabular-nums text-primary">{fmtCurrency(line.amountUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface-hover">
              <th scope="row" className="px-4 py-2.5 text-left text-callout font-semibold text-secondary" colSpan={5}>{u.subtotal}</th>
              <td className="px-4 py-2.5 text-right text-body font-semibold tabular-nums text-primary">{fmtCurrency(subtotalUsd)}</td>
            </tr>
          </tfoot>
        </table></div>
      )}
    </section>
  );
}
