'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatCurrency } from '../../../../lib/format-utils';
import { ErrorState, Skeleton } from '../../../../components';
import { useDashboardMrrTrend } from '../../../../lib/platform-api/dashboard';

// Bar height in px for the tallest month; heights are data-driven, so they stay an inline style.
const BAR_AREA_PX = 72;

/** Six-month MRR bars (navy chart ramp; the current month is the darkest). Compact on phones, never hidden. */
export function MrrTrendChart() {
  const { t } = useI18n();
  const mrrTrend = useDashboardMrrTrend();

  return (
    <section aria-labelledby="mrr-trend-title" className="mb-4 shrink-0 rounded-xl bg-white p-4 shadow-card md:mb-5 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="mrr-trend-title" className="text-subheading font-semibold text-primary">
          {t.subscriptions.mrrTrend}
        </h2>
        <span className="text-callout text-secondary">{t.subscriptions.lastMonths}</span>
      </div>
      {mrrTrend.isLoading ? (
        <Skeleton className="h-28 w-full md:h-32" />
      ) : mrrTrend.isError ? (
        <ErrorState size="compact" onRetry={() => mrrTrend.refetch()} error={mrrTrend.error} />
      ) : mrrTrend.data ? (
        (() => {
          const last6 = mrrTrend.data.slice(-6);
          const max = Math.max(...last6.map((m) => m.mrr), 1);
          return (
            <ul className="flex h-28 items-end gap-2 px-1 md:h-32 md:gap-4">
              {last6.map((m, i) => {
                const barH = m.mrr > 0 ? Math.max(Math.round((m.mrr / max) * BAR_AREA_PX), 6) : 3;
                const isLast = i === last6.length - 1;
                const tone = m.mrr === 0 ? 'bg-chart-grid' : isLast ? 'bg-chart-1' : 'bg-chart-4';
                const month = m.month.charAt(0).toUpperCase() + m.month.slice(1);
                return (
                  <li key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className={`truncate text-caption tabular-nums ${isLast ? 'font-semibold text-primary' : 'text-secondary'}`}>
                      {formatCurrency(m.mrr, 'USD', 0)}
                    </span>
                    <div className={`w-full shrink-0 rounded-t-md ${tone}`} style={{ height: barH }} aria-hidden="true" />
                    <span className={`text-caption ${isLast ? 'font-medium text-primary' : 'text-muted'}`}>{month}</span>
                  </li>
                );
              })}
            </ul>
          );
        })()
      ) : null}
    </section>
  );
}
