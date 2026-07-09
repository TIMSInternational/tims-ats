'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { Skeleton, ErrorState, EmptyState } from '../../../../../../components';
import type { UsageBillingLine } from '../../../../../../lib/trpc-types';

const emptyIcon = (
  <svg className="w-10 h-10 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
    <path d="M9 14l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);
}

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

  const handleGenerate = () => {
    if (!periodStart || !periodEnd) return;
    if (!window.confirm(t.usageBilling.generateConfirm)) return;
    generateInvoice.mutate({ orgId, periodStart, periodEnd });
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[#EDEDED]">
        <h3 className="text-sm font-semibold text-[#333]">{t.usageBilling.title}</h3>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#8B8B8B]">{t.usageBilling.periodLabel}</label>
          <input
            type="date"
            value={periodStartInput}
            onChange={(e) => setPeriodStartInput(e.target.value)}
            disabled={generateInvoice.isPending}
            className="h-8 px-2 rounded-lg border border-[#EDEDED] text-xs text-[#333] disabled:opacity-50"
          />
          <span className="text-xs text-[#8B8B8B]">{'–'}</span>
          <input
            type="date"
            value={periodEndInput}
            onChange={(e) => setPeriodEndInput(e.target.value)}
            disabled={generateInvoice.isPending}
            className="h-8 px-2 rounded-lg border border-[#EDEDED] text-xs text-[#333] disabled:opacity-50"
          />
          <button
            onClick={handleGenerate}
            disabled={generateInvoice.isPending || !hasValidPeriod || lines.length === 0 || subtotalUsd <= 0}
            className="h-8 px-3 rounded-lg bg-[#1F114C] text-xs text-white font-medium hover:bg-[#2a1866] transition disabled:opacity-50"
          >
            {t.usageBilling.generate}
          </button>
        </div>
      </div>

      {!hasValidPeriod ? (
        <EmptyState icon={emptyIcon} message={t.usageBilling.emptyPeriod} />
      ) : preview.isLoading ? (
        <div className="p-5 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <Skeleton className="h-3 w-32" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : preview.isError ? (
        <ErrorState onRetry={() => preview.refetch()} />
      ) : lines.length === 0 ? (
        <EmptyState icon={emptyIcon} message={t.usageBilling.noUsage} />
      ) : (
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-[#EDEDED]">
              <th className="px-5 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.usageBilling.moduleCol}</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.usageBilling.usageCol}</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.usageBilling.includedCol}</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.usageBilling.billableCol}</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.usageBilling.unitPriceCol}</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.usageBilling.amountCol}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F3F3]">
            {lines.map((line) => (
              <tr key={line.moduleCode} className="hover:bg-[#FAFAFA]">
                <td className="px-5 py-2.5 text-sm text-[#333] font-medium">{line.name}</td>
                <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{line.quantity} {line.unit}</td>
                <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{line.includedQty}</td>
                <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{line.billableQty}</td>
                <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{fmtCurrency(line.unitPrice)}</td>
                <td className="px-4 py-2.5 text-sm text-[#333] font-medium">{fmtCurrency(line.amountUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#EDEDED] bg-[#FAFAFA]">
              <td className="px-5 py-2.5 text-xs text-[#8B8B8B] font-semibold" colSpan={5}>{t.usageBilling.subtotal}</td>
              <td className="px-4 py-2.5 text-sm text-[#333] font-bold">{fmtCurrency(subtotalUsd)}</td>
            </tr>
          </tfoot>
        </table></div>
      )}
    </div>
  );
}
