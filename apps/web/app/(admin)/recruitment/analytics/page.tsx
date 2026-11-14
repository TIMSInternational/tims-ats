'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';
import { PageHeader } from '../../../../components/page-header';
import { SegmentedControl } from '../../../../components/segmented-control';
import { isForbiddenError } from '../../../../lib/forbidden-error';
import { useReportingKpis } from '../../../../lib/platform-api/reporting';
import { AnalyticsKpiRow } from './analytics-kpi-row';
import { AnalyticsFunnel, AnalyticsSourceQuality } from './analytics-funnel';
import { AnalyticsTrend, AnalyticsLostByDelay } from './analytics-trends';
import { AnalyticsSlaTable } from './analytics-tables';

const PERIODS = ['7D', '30D', '90D', '6M', '1Y'] as const;
export type AnalyticsPeriod = (typeof PERIODS)[number];

const PERIOD_LABEL_KEYS = {
  '7D': 'period7d',
  '30D': 'period30d',
  '90D': 'period90d',
  '6M': 'period6m',
  '1Y': 'period1y',
} as const satisfies Record<AnalyticsPeriod, string>;

export default function RecruitmentAnalyticsPage() {
  const { t } = useI18n();
  const [activePeriod, setActivePeriod] = useState<AnalyticsPeriod>('30D');
  // The same query (and cache entry) the KPI row reads: a permission denial becomes ONE page-level
  // message instead of six red fragments (feedback.md › Best practices).
  const kpis = useReportingKpis(activePeriod);
  const forbidden = isForbiddenError(kpis.error);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title={t.recruitAnalytics.title}
        description={t.recruitAnalytics.pageDescription}
        actions={
          !forbidden && (
            <SegmentedControl
              label={t.recruitAnalytics.periodLabel}
              value={activePeriod}
              onChange={setActivePeriod}
              options={PERIODS.map((p) => ({ value: p, label: t.recruitAnalytics[PERIOD_LABEL_KEYS[p]] }))}
            />
          )
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {forbidden ? (
          <ErrorState error={kpis.error} title={t.recruitAnalytics.noAccess} />
        ) : (
          <div className="space-y-6">
            <AnalyticsKpiRow period={activePeriod} />

            <div className="flex flex-col gap-4 md:flex-row">
              <AnalyticsFunnel />
              <AnalyticsSourceQuality period={activePeriod} />
            </div>

            <div className="flex flex-col gap-4 md:flex-row">
              <AnalyticsTrend />
              <AnalyticsLostByDelay period={activePeriod} />
            </div>

            <AnalyticsSlaTable />
          </div>
        )}
      </div>
    </div>
  );
}
