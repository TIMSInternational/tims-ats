'use client';

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

export default function DashboardPage() {
  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Attention Bar */}
        <AttentionBar />

        {/* KPI Strip */}
        <KpiStrip />

        {/* Row 1: MRR Trend + Revenue by Customer */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <MrrTrendChart />
          <RevenueByCustomerChart />
        </div>

        {/* Row 2: MRR Forecast (full width) */}
        <div className="mb-5">
          <MrrForecastChart />
        </div>

        {/* Row 3: Upsell + AI Cost Anomalies */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <UpsellPanel />
          <AiCostAnomalyPanel />
        </div>

        {/* Row 4: Churn Risk (full width) */}
        <div className="mb-5">
          <ChurnRiskPanel />
        </div>

        {/* Row 5: Plan Distribution + Customer Health */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <PlanDistributionChart />
          <CustomerHealthGrid />
        </div>

        {/* Customer Table (full width) */}
        <div className="mb-5">
          <CustomerTable />
        </div>

        {/* Activity Feed */}
        <ActivityFeed />
      </div>
    </div>
  );
}
