'use client';

import { trpc } from '../../../lib/trpc';
import { KpiSection } from './kpi-section';
import { RecentActivity } from './recent-activity';
import {
  UserGrowthChart,
  PlanDistribution,
  SystemAlerts,
  MrrTrendChart,
  PlatformMetrics,
  QuickActions,
} from './charts-section';

export default function DashboardPage() {
  const kpis = trpc.platform.getDashboardKpis.useQuery();
  const activity = trpc.platform.getRecentActivity.useQuery();
  const planDist = trpc.platform.getPlanDistribution.useQuery();
  const userGrowth = trpc.platform.getUserGrowth.useQuery();
  const alerts = trpc.notification.list.useQuery({ limit: 5 });
  const mrrTrend = trpc.platform.getMrrTrend.useQuery();

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <KpiSection data={kpis.data} isLoading={kpis.isLoading} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Two Column Layout */}
        <div className="flex gap-5 mb-6">
          {/* LEFT 60% */}
          <div className="w-[60%] flex flex-col gap-5">
            <RecentActivity data={activity.data} isLoading={activity.isLoading} />
            <UserGrowthChart data={userGrowth.data} isLoading={userGrowth.isLoading} />
          </div>

          {/* RIGHT 40% */}
          <div className="w-[40%] flex flex-col gap-5">
            <PlanDistribution data={planDist.data} isLoading={planDist.isLoading} />
            <SystemAlerts notifications={alerts.data?.notifications} isLoading={alerts.isLoading} />
            <QuickActions />
          </div>
        </div>

        {/* Bottom: Revenue Trend + Platform Stats */}
        <div className="flex gap-5">
          <MrrTrendChart data={mrrTrend.data} isLoading={mrrTrend.isLoading} />
          <PlatformMetrics mrr={kpis.data?.mrr} totalOrgs={kpis.data?.totalOrgs} />
        </div>
      </div>
    </div>
  );
}
