'use client';

import { useI18n } from '../../../../lib/i18n';

interface KpiItem {
  label: string;
  value: string | number;
  subtitle: string;
  change: string;
  trend: 'up' | 'down';
  valueColor?: string;
}

function TrendIcon({ direction }: { direction: 'up' | 'down' }) {
  if (direction === 'up') {
    return (
      <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="m4.5 15.75 7.5-7.5 7.5 7.5" />
      </svg>
    );
  }
  return (
    <svg className="w-3 h-3 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

export function AnalyticsKpiRow() {
  const { t } = useI18n();

  const kpis: KpiItem[] = [
    {
      label: t.recruitAnalytics.timeToFill,
      value: 23,
      subtitle: t.recruitAnalytics.avgDays,
      change: `-3 ${t.recruitAnalytics.vsLast}`,
      trend: 'up',
    },
    {
      label: t.recruitAnalytics.timeToHire,
      value: 18,
      subtitle: t.recruitAnalytics.avgDays,
      change: `-2 ${t.recruitAnalytics.vsLast}`,
      trend: 'up',
    },
    {
      label: t.recruitAnalytics.costPerHire,
      value: '$2.4K',
      subtitle: t.recruitAnalytics.usdAvg,
      change: `+$200 ${t.recruitAnalytics.vsLast}`,
      trend: 'down',
    },
    {
      label: t.recruitAnalytics.offerAcceptRate,
      value: '87%',
      subtitle: t.recruitAnalytics.acceptRate,
      change: `+5% ${t.recruitAnalytics.vsLast}`,
      trend: 'up',
      valueColor: 'text-green-600',
    },
    {
      label: t.recruitAnalytics.qualityOfHire,
      value: 76,
      subtitle: t.recruitAnalytics.qohIndex,
      change: `+4 ${t.recruitAnalytics.vsLast}`,
      trend: 'up',
    },
    {
      label: t.recruitAnalytics.candidatesLost,
      value: 12,
      subtitle: t.recruitAnalytics.byDelay,
      change: `+3 ${t.recruitAnalytics.vsLast}`,
      trend: 'down',
      valueColor: 'text-[#DD0C15]',
    },
  ];

  return (
    <div className="grid grid-cols-6 gap-3 mb-6">
      {kpis.map((kpi) => {
        const isNegative = kpi.trend === 'down';
        const changeColor = isNegative ? 'text-[#DD0C15]' : 'text-green-500';
        return (
          <div
            key={kpi.label}
            className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center"
          >
            <p className="text-[11px] text-[#8B8B8B] mb-1">{kpi.label}</p>
            <p className={`text-[24px] font-bold ${kpi.valueColor ?? 'text-[#1F114C]'}`}>
              {kpi.value}
            </p>
            <p className="text-[10px] text-[#8B8B8B]">{kpi.subtitle}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              <TrendIcon direction={kpi.trend} />
              <span className={`text-[10px] ${changeColor} font-medium`}>{kpi.change}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
