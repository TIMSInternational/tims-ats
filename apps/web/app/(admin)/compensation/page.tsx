'use client';

import { useI18n } from '../../../lib/i18n';
import { useCompensationDashboardKpis } from '../../../lib/platform-api/compensation';
import { PageHeader } from '../../../components';
import { CompKpis } from './comp-kpis';
import { SalaryBands, PayEquityCard } from './comp-left-column';
import { CompaRatioDistribution, BenefitsUtilization, PendingAdjustments } from './comp-right-column';
import { MarketCompetitiveness, TotalCompBreakdown } from './comp-bottom-row';

/**
 * Read-only dashboard: no primary action. "Simular ajuste" and "Exportar" only ever showed a
 * "próximamente" toast, so they are not offered until the features exist.
 */
export default function CompensationPage() {
  const { t } = useI18n();
  const kpis = useCompensationDashboardKpis();

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.compensation.title} />

      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
        <CompKpis
          data={kpis.data ?? null}
          loading={kpis.isLoading}
          isError={kpis.isError}
          error={kpis.error}
          onRetry={() => kpis.refetch()}
        />

        {/* Two independent columns, so neither leaves a gap beside a taller neighbour. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="min-w-0 space-y-4 lg:col-span-7">
            <SalaryBands />
            <PayEquityCard />
            <MarketCompetitiveness />
          </div>
          <div className="min-w-0 space-y-4 lg:col-span-5">
            <CompaRatioDistribution />
            <BenefitsUtilization />
            <PendingAdjustments />
            <TotalCompBreakdown />
          </div>
        </div>
      </div>
    </div>
  );
}
