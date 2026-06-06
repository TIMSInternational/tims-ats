'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { AnalyticsKpiRow } from './analytics-kpi-row';
import { AnalyticsFunnel, AnalyticsSourceQuality } from './analytics-funnel';
import { AnalyticsTrend, AnalyticsLostByDelay, AnalyticsVacancyPrediction } from './analytics-trends';
import { AnalyticsSlaTable, AnalyticsQohBreakdown } from './analytics-tables';

const PERIODS = ['7D', '30D', '90D', '6M', '1Y'] as const;
export type AnalyticsPeriod = (typeof PERIODS)[number];

export default function RecruitmentAnalyticsPage() {
  const { t } = useI18n();
  const [activePeriod, setActivePeriod] = useState<AnalyticsPeriod>('30D');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.recruitAnalytics.breadcrumb}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.recruitAnalytics.title}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setActivePeriod(p)}
                className={`px-3 h-8 text-[12px] ${
                  activePeriod === p
                    ? 'bg-[#1F114C] text-white font-medium'
                    : 'text-[#585858]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t.recruitAnalytics.export}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* KPI Row */}
        <AnalyticsKpiRow period={activePeriod} />

        {/* Row 2: Funnel + Source Performance */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <AnalyticsFunnel />
          <AnalyticsSourceQuality period={activePeriod} />
        </div>

        {/* Row 3: Trend + Lost + Prediction */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <AnalyticsTrend />
          <AnalyticsLostByDelay period={activePeriod} />
          <AnalyticsVacancyPrediction />
        </div>

        {/* Row 4: SLA Table + QoH Breakdown */}
        <div className="flex flex-col md:flex-row gap-4">
          <AnalyticsSlaTable />
          <AnalyticsQohBreakdown />
        </div>
      </div>
    </div>
  );
}
