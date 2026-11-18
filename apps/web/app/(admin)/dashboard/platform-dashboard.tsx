'use client';

import { useI18n } from '../../../lib/i18n';
import { useDashboardAiCostAnomalies, useDashboardUpsellOpportunities } from '../../../lib/platform-api/dashboard';
import { AttentionBar } from './attention-bar';
import { KpiStrip } from './kpi-strip';
import { MrrTrendChart } from './charts/mrr-trend-chart';
import { MrrForecastChart } from './charts/mrr-forecast-chart';
import { RevenueByCustomerChart } from './charts/revenue-by-customer';
import { PlanDistributionChart } from './charts/plan-distribution';
import { CustomerHealthGrid } from './charts/customer-health';
import { ChurnRiskPanel } from './charts/churn-risk-panel';
import { UpsellPanel } from './charts/upsell-panel';
import { AiCostAnomalyPanel } from './charts/ai-cost-anomaly-panel';
import { CustomerTable } from './customer-table';
import { ActivityFeed } from './activity-feed';
import { DashboardPage } from './dashboard-page';

/**
 * The platform owner's overview, ordered by decision (charting-data.md › Best practices): what needs
 * attention, the headline figures, who may churn, the customer list, then revenue trends, mix and the
 * per-organisation health grid, then opportunities, then activity and system status.
 */
export function PlatformDashboard() {
  const { t } = useI18n();
  const d = t.dashboard;
  // Same query keys as the two panels: these reads are shared from the cache, not repeated.
  const upsell = useDashboardUpsellOpportunities();
  const aiCost = useDashboardAiCostAnomalies();
  const nothingToAct =
    upsell.isSuccess &&
    aiCost.isSuccess &&
    (upsell.data?.opportunities.length ?? 0) === 0 &&
    (aiCost.data?.anomalies.length ?? 0) === 0;

  return (
    <DashboardPage title={d.platformTitle} description={d.platformSubtitle}>
      <AttentionBar />
      <KpiStrip />

      <div className="mb-5">
        <ChurnRiskPanel />
      </div>

      <div className="mb-5">
        <CustomerTable />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <MrrTrendChart />
        <RevenueByCustomerChart />
      </div>

      <div className="mb-5">
        <MrrForecastChart />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <PlanDistributionChart />
        <CustomerHealthGrid />
      </div>

      {/* Two full-height empty cards say nothing twice: one quiet line covers both. */}
      {nothingToAct ? (
        <p className="mb-5 rounded-xl border border-border bg-white px-5 py-4 text-body text-secondary shadow-card">
          {d.noOpportunitiesOrAnomalies}
        </p>
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <UpsellPanel />
          <AiCostAnomalyPanel />
        </div>
      )}

      <ActivityFeed />
    </DashboardPage>
  );
}
