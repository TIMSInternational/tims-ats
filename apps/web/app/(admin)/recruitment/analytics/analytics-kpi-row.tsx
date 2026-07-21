'use client';

import { useI18n } from '../../../../lib/i18n';
import { useReportingKpis } from '../../../../lib/platform-api/reporting';
import type { AnalyticsPeriod } from './page';

function KpiSkeleton() {
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-16 bg-gray-100 rounded" />
    </div>
  );
}

interface KpiItem {
  label: string;
  value: string | number;
  subtitle: string;
  valueColor?: string;
}

export function AnalyticsKpiRow({ period }: { period: AnalyticsPeriod }) {
  const { t } = useI18n();
  const q = useReportingKpis(period);

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="bg-white rounded-xl p-4 mb-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center text-[12px] text-[#DD0C15]">
        {t.recruitAnalytics.errLoading}
      </div>
    );
  }

  const d = q.data;
  const kpis: KpiItem[] = [
    {
      label: t.recruitAnalytics.timeToFill,
      value: d.timeToFillDays ?? '—',
      subtitle: d.timeToFillDays != null ? t.recruitAnalytics.avgDays : t.recruitAnalytics.noHiresInPeriod,
    },
    {
      label: t.recruitAnalytics.timeToHire,
      value: d.timeToHireDays ?? '—',
      subtitle: d.timeToHireDays != null ? t.recruitAnalytics.avgDays : t.recruitAnalytics.noHiresInPeriod,
    },
    {
      // No cost data source exists — honest unavailable, never a fabricated number.
      label: t.recruitAnalytics.costPerHire,
      value: '—',
      subtitle: t.recruitAnalytics.requiresCostData,
      valueColor: 'text-[#8B8B8B]',
    },
    {
      label: t.recruitAnalytics.offerAcceptRate,
      value: d.offerAcceptRatePct != null ? `${d.offerAcceptRatePct}%` : '—',
      subtitle: `${d.offersAccepted}/${d.offersSent} ${t.recruitAnalytics.offersLabel}`,
      valueColor: d.offerAcceptRatePct != null ? 'text-green-600' : 'text-[#8B8B8B]',
    },
    {
      // Requires performance/retention data — honest unavailable.
      label: t.recruitAnalytics.qualityOfHire,
      value: '—',
      subtitle: t.recruitAnalytics.requiresPerfData,
      valueColor: 'text-[#8B8B8B]',
    },
    {
      label: t.recruitAnalytics.candidatesLost,
      value: d.lostByDelay,
      subtitle: t.recruitAnalytics.byDelay,
      valueColor: d.lostByDelay > 0 ? 'text-[#DD0C15]' : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center"
        >
          <p className="text-[11px] text-[#8B8B8B] mb-1">{kpi.label}</p>
          <p className={`text-[20px] md:text-[24px] font-bold ${kpi.valueColor ?? 'text-[#1F114C]'}`}>
            {kpi.value}
          </p>
          <p className="text-[10px] text-[#8B8B8B]">{kpi.subtitle}</p>
        </div>
      ))}
    </div>
  );
}
