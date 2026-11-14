'use client';

import { useI18n } from '../../../../lib/i18n';
import {
  useReportingFunnel,
  useReportingSourceBreakdown,
} from '../../../../lib/platform-api/reporting';
import type { AnalyticsPeriod } from './page';
import { AnalyticsCard } from './analytics-card';
import { pluralize } from '../../../../lib/i18n/format';

export function AnalyticsFunnel() {
  const { t } = useI18n();
  const q = useReportingFunnel();
  const data = q.data;

  return (
    <AnalyticsCard
      title={t.recruitAnalytics.funnel}
      loading={q.isLoading}
      error={q.isError || (!q.isLoading && !data) ? (q.error ?? true) : undefined}
      onRetry={() => void q.refetch()}
    >
      {data && (
        <>
          {data.stages.length === 0 ? (
            <p className="py-8 text-center text-callout text-secondary">{t.recruitAnalytics.noFunnelData}</p>
          ) : (
            <ul className="space-y-2">
              {data.stages.map((stage) => (
                <li key={stage.name} className="flex items-center gap-3">
                  <span className="line-clamp-2 w-28 shrink-0 text-callout text-secondary sm:w-36">{stage.name}</span>
                  {/* True length: a stage with 0 shows an empty track, never a filled pill. */}
                  <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                    <div
                      className={`h-5 rounded-full bg-chart-2 ${stage.count > 0 ? 'min-w-0.5' : 'hidden'}`}
                      style={{ width: `${stage.pctOfMax}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-callout font-medium text-primary tabular-nums">{stage.count}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 border-t border-border pt-3">
            <span className="text-callout text-secondary">
              {t.recruitAnalytics.totalConversion}:{' '}
              <strong className="text-brand tabular-nums">{data.conversionPct != null ? `${data.conversionPct}%` : '—'}</strong>
            </span>
            <span className="text-callout text-secondary">
              {t.recruitAnalytics.hired}: <strong className="text-brand tabular-nums">{data.totalHired}</strong> /{' '}
              <span className="tabular-nums">{data.totalApplications}</span>
            </span>
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}

export function AnalyticsSourceQuality({ period }: { period: AnalyticsPeriod }) {
  const { t, locale } = useI18n();
  const q = useReportingSourceBreakdown(period);
  const sources = q.data;
  const maxApps = Math.max(1, ...(sources ?? []).map((s) => s.applications));

  return (
    <AnalyticsCard
      title={t.recruitAnalytics.sourcesTitle}
      loading={q.isLoading}
      error={q.isError || (!q.isLoading && !sources) ? (q.error ?? true) : undefined}
      onRetry={() => void q.refetch()}
    >
      {sources &&
        (sources.length === 0 ? (
          <p className="py-8 text-center text-callout text-secondary">{t.recruitAnalytics.noSourceData}</p>
        ) : (
          <ul className="space-y-3">
            {sources.map((src) => (
              <li key={src.source}>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
                  <span className="text-callout font-medium capitalize text-primary">{src.source}</span>
                  <span className="flex items-center gap-4 tabular-nums">
                    <span className="text-callout text-secondary">
                      {pluralize(src.applications, { one: t.recruitAnalytics.applicationsOne, other: t.recruitAnalytics.applicationsOther }, locale)}
                    </span>
                    <span className={`text-callout font-medium ${src.hires > 0 ? 'text-success' : 'text-secondary'}`}>
                      {pluralize(src.hires, { one: t.recruitAnalytics.hiresOne, other: t.recruitAnalytics.hiresOther }, locale)}
                    </span>
                  </span>
                </div>
                {/* One series: one colour, no legend swatch that matches nothing. */}
                <div className="h-3 w-full overflow-hidden rounded-sm bg-surface" aria-hidden="true">
                  <div className="h-3 rounded-sm bg-chart-3" style={{ width: `${Math.round((src.applications / maxApps) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ))}
    </AnalyticsCard>
  );
}
