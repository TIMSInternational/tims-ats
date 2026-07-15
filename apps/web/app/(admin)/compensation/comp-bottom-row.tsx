'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { formatCurrency } from '../../../lib/format-utils';

export function MarketCompetitiveness() {
  const { t } = useI18n();
  // No external market salary source is integrated, so percentile-vs-market can't
  // be computed honestly. Render an explicit unavailable state (rule #4).
  return (
    <div className="col-span-12 md:col-span-7 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">{t.compensation.marketTitle}</div>
      <div className="flex items-center justify-center h-[120px] text-center">
        <p className="text-[12px] text-[#8B8B8B] max-w-md">{t.compensation.marketUnavailable}</p>
      </div>
    </div>
  );
}

export function TotalCompBreakdown() {
  const { t } = useI18n();
  const q = trpc.compensation.getTotalCompBreakdown.useQuery();

  // min-5 suppression (round 6): the backend nulls totalComp/breakdown totals + percentages
  // + employeeCount when the comp population is 1..4. Render a mask ('N/D') rather than crash.
  const data = q.data;
  const isSuppressed =
    !!data && (data.suppressed === true || data.totalComp === null);
  const basePct = data?.breakdown.baseSalary.percentage ?? 0;
  const varPct = data?.breakdown.variablePay.percentage ?? 0;

  return (
    <div className="col-span-12 md:col-span-5 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">{t.compensation.totalCompTitle}</div>
      {q.isLoading ? (
        <div className="h-28 bg-gray-50 rounded animate-pulse" />
      ) : q.isError || !data ? (
        <p className="text-[12px] text-[#DD0C15]">{t.compensation.totalCompErr}</p>
      ) : isSuppressed ? (
        <p className="text-[22px] font-bold text-[#8B8B8B] mb-3">{t.dei.na}</p>
      ) : (
        <>
          <p className="text-[22px] font-bold text-[#333] mb-3">{formatCurrency(data.totalComp ?? 0, data.currency ?? 'USD')}<span className="text-[11px] text-[#8B8B8B] font-normal"> · {data.employeeCount ?? 0} {t.compensation.employeesShort}</span></p>
          <div className="flex h-5 rounded-full overflow-hidden mb-3">
            <div className="bg-[#1F114C] h-full" style={{ width: `${basePct}%` }} />
            <div className="bg-[#DD0C15] h-full" style={{ width: `${varPct}%` }} />
          </div>
          <div className="flex items-center gap-4 pt-2 border-t border-[#EDEDED]">
            <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]">
              <div className="w-3 h-2 rounded bg-[#1F114C]" /> {t.compensation.legendBase} ({basePct}%)
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]">
              <div className="w-3 h-2 rounded bg-[#DD0C15]" /> {t.compensation.legendVariable} ({varPct}%)
            </div>
          </div>
        </>
      )}
    </div>
  );
}
