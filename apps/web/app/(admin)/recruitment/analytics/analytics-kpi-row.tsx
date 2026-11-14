'use client';

import { useI18n } from '../../../../lib/i18n';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import { useReportingKpis } from '../../../../lib/platform-api/reporting';
import type { AnalyticsPeriod } from './page';

export function AnalyticsKpiRow({ period }: { period: AnalyticsPeriod }) {
  const { t } = useI18n();
  const q = useReportingKpis(period);

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (q.isError || !q.data) {
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} size="compact" />;
  }

  const d = q.data;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={t.recruitAnalytics.timeToFill}
          value={d.timeToFillDays ?? '—'}
          subtitle={d.timeToFillDays != null ? t.recruitAnalytics.avgDays : t.recruitAnalytics.noHiresInPeriod}
        />
        <KpiCard
          label={t.recruitAnalytics.timeToHire}
          value={d.timeToHireDays ?? '—'}
          subtitle={d.timeToHireDays != null ? t.recruitAnalytics.avgDays : t.recruitAnalytics.noHiresInPeriod}
        />
        <KpiCard
          label={t.recruitAnalytics.offerAcceptRate}
          value={d.offerAcceptRatePct != null ? `${d.offerAcceptRatePct}%` : '—'}
          subtitle={`${d.offersAccepted}/${d.offersSent} ${t.recruitAnalytics.offersLabel}`}
        />
        <KpiCard
          label={t.recruitAnalytics.candidatesLost}
          value={d.lostByDelay}
          subtitle={t.recruitAnalytics.byDelay}
          tone="danger"
        />
      </div>
      {/* The metrics with no data source yet are named once, instead of four permanent "no disponible" slots. */}
      <p className="mt-2 text-callout text-secondary">{t.recruitAnalytics.comingSoonNote}</p>
    </div>
  );
}
