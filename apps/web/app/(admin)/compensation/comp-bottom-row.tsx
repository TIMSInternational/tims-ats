'use client';

import { useI18n } from '../../../lib/i18n';
import { formatCurrency } from '../../../lib/format-utils';
import { useCompensationTotalCompBreakdown } from '../../../lib/platform-api/compensation';
import { Skeleton } from '../../../components';
import { CompCard } from './comp-card';
import { CompCardError } from './comp-card-error';

export function MarketCompetitiveness() {
  const { t } = useI18n();
  // No external market salary source is integrated, so percentile-vs-market can't
  // be computed honestly. A one-line notice says so instead of a card-sized void.
  return (
    <p className="flex items-start gap-2 rounded-xl border border-border bg-white px-4 py-3 text-callout text-secondary shadow-card">
      <svg className="mt-0.5 size-4 shrink-0 text-info" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
      <span>
        <span className="font-medium text-primary">{t.compensation.marketTitle}:</span> {t.compensation.marketUnavailable}
      </span>
    </p>
  );
}

export function TotalCompBreakdown() {
  const { t } = useI18n();
  const q = useCompensationTotalCompBreakdown();

  // min-5 suppression (round 6): the backend nulls totalComp/breakdown totals + percentages
  // + employeeCount when the comp population is 1..4. Render a mask ('N/D') rather than crash.
  const data = q.data;
  const isSuppressed = !!data && (data.suppressed === true || data.totalComp === null);
  const basePct = data?.breakdown.baseSalary.percentage ?? 0;
  const varPct = data?.breakdown.variablePay.percentage ?? 0;
  const isEmpty = !!data && !isSuppressed && (data.totalComp ?? 0) === 0;

  return (
    <CompCard title={t.compensation.totalCompTitle}>
      {q.isLoading ? (
        <Skeleton className="h-28" />
      ) : q.isError || !data ? (
        <CompCardError message={t.compensation.totalCompErr} error={q.error} onRetry={() => q.refetch()} />
      ) : isSuppressed ? (
        <p className="mb-3 font-display text-title font-semibold text-muted">{t.dei.na}</p>
      ) : isEmpty ? (
        <p className="text-callout text-secondary">{t.compensation.totalCompEmpty}</p>
      ) : (
        <>
          <p className="mb-3 font-display text-title font-semibold tabular-nums text-primary">
            {formatCurrency(data.totalComp ?? 0, data.currency ?? 'USD')}
            <span className="font-sans text-callout font-normal text-secondary">
              {' '}
              · {data.employeeCount ?? 0} {t.compensation.employeesShort}
            </span>
          </p>
          <div className="mb-3 flex h-5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <div className="h-full bg-brand" style={{ width: `${basePct}%` }} />
            <div className="h-full bg-brand-red" style={{ width: `${varPct}%` }} />
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2">
            <li className="flex items-center gap-1.5 text-callout text-secondary">
              <span className="h-2 w-3 rounded bg-brand" aria-hidden="true" /> {t.compensation.legendBase} ({basePct}%)
            </li>
            <li className="flex items-center gap-1.5 text-callout text-secondary">
              <span className="h-2 w-3 rounded bg-brand-red" aria-hidden="true" /> {t.compensation.legendVariable} ({varPct}%)
            </li>
          </ul>
        </>
      )}
    </CompCard>
  );
}
