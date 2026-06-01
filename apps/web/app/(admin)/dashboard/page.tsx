'use client';

import { AttentionBar } from './attention-bar';
import { KpiStrip } from './kpi-strip';
import { MrrTrendChart } from './charts/mrr-trend-chart';
import { RevenueByCustomerChart } from './charts/revenue-by-customer';
import { PlanDistributionChart } from './charts/plan-distribution';
import { CustomerHealthGrid } from './charts/customer-health';
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

        {/* Charts Row 1: MRR Trend + Revenue by Customer */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <MrrTrendChart />
          <RevenueByCustomerChart />
        </div>

        {/* Charts Row 2: Plan Distribution + Customer Health */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <PlanDistributionChart />
          <CustomerHealthGrid />
        </div>

        {/* Customer Table (full width) */}
        <div className="mb-5">
          <CustomerTable />
        </div>

        {/* Activity Feed + System Status */}
        <ActivityFeed />
      </div>
    </div>
  );
}
