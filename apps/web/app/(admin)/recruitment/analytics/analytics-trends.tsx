'use client';

import { useI18n } from '../../../../lib/i18n';
import {
  useReportingTrend,
  useReportingLostByDelay,
} from '../../../../lib/platform-api/reporting';
import type { AnalyticsPeriod } from './page';
import { AnalyticsCard } from './analytics-card';
import { StatusBadge } from '../../../../components/status-badge';

export function AnalyticsTrend() {
  const { t, locale } = useI18n();
  const q = useReportingTrend();
  const months = q.data;
  const max = Math.max(1, ...(months ?? []).map((m) => m.count));
  const fmt = new Intl.DateTimeFormat(locale === 'ES' ? 'es' : 'en', { month: 'short' });

  return (
    <AnalyticsCard
      title={t.recruitAnalytics.trendTitle}
      flex="md:flex-[60]"
      loading={q.isLoading}
      error={q.isError || (!q.isLoading && !months) ? (q.error ?? true) : undefined}
      onRetry={() => void q.refetch()}
    >
      {months && (
        <>
          <div className="flex h-[160px] items-end gap-2 px-2">
            {months.map((m) => (
              <div key={`${m.year}-${m.month}`} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-caption font-medium text-primary tabular-nums">{m.count}</span>
                <div
                  className="w-full rounded-t-sm bg-chart-3"
                  aria-hidden="true"
                  style={{ height: `${Math.max(Math.round((m.count / max) * 110), m.count > 0 ? 6 : 2)}px` }}
                />
                <span className="text-caption capitalize text-muted">{fmt.format(new Date(m.year, m.month, 1))}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <span className="size-3 rounded-sm bg-chart-3" aria-hidden="true" />
            <span className="text-callout text-secondary">{t.recruitAnalytics.actual}</span>
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}

export function AnalyticsLostByDelay({ period }: { period: AnalyticsPeriod }) {
  const { t } = useI18n();
  const q = useReportingLostByDelay(period);
  const data = q.data;

  return (
    <AnalyticsCard
      title={t.recruitAnalytics.lostByDelay}
      flex="md:flex-[40]"
      loading={q.isLoading}
      error={q.isError || (!q.isLoading && !data) ? (q.error ?? true) : undefined}
      onRetry={() => void q.refetch()}
      aside={
        data && (
          // Red only when something was lost; zero is neutral, never a green "good news" badge.
          <StatusBadge tone={data.total > 0 ? 'danger' : 'neutral'} icon="none" className="tabular-nums">
            {data.total}
          </StatusBadge>
        )
      }
    >
      {data &&
        (data.items.length === 0 ? (
          <p className="py-8 text-center text-callout text-secondary">{t.recruitAnalytics.noneLostByDelay}</p>
        ) : (
          <ul className="space-y-2">
            {data.items.map((item) => (
              <li key={item.stageName} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                <div>
                  <p className="text-callout font-medium text-primary">{item.stageName}</p>
                  <p className="text-caption text-danger tabular-nums">
                    {item.lostCount} {t.recruitAnalytics.candidates.toLowerCase()}
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="text-callout font-semibold text-danger">
                    +{item.avgDaysOver}d {t.recruitAnalytics.avgOverSla}
                  </p>
                  <p className="text-caption text-muted">SLA: {item.slaDays}d</p>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </AnalyticsCard>
  );
}
