'use client';

import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { trpc } from '../../../../lib/trpc';
import { formatCurrency, PLAN_COLORS, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';

interface RevenueTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: { orgName: string; plan: string; mrr: number; userCount: number };
  }>;
}

function RevenueTooltip({ active, payload }: RevenueTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-lg min-w-[160px]">
      <p className="text-sm font-semibold text-primary">{d.orgName}</p>
      <div className="mt-1 space-y-0.5">
        <p className="text-xs text-muted">
          Plan: <span className="font-medium text-secondary">{PLAN_LABELS[d.plan] ?? d.plan}</span>
        </p>
        <p className="text-xs text-muted">
          MRR: <span className="font-medium text-secondary">{formatCurrency(d.mrr)}</span>
        </p>
        <p className="text-xs text-muted">
          Users: <span className="font-medium text-secondary">{d.userCount}</span>
        </p>
      </div>
    </div>
  );
}

export function RevenueByCustomerChart() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = trpc.platform.getRevenueByCustomer.useQuery();

  // Filter to only orgs with MRR > 0 for the chart
  const chartData = (data ?? []).filter((d) => d.mrr > 0).slice(0, 10);

  return (
    <div className="rounded-xl border border-border bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-primary">{t.dashboard.revenueByCustomer}</h3>
          <p className="text-xs text-muted">{t.dashboard.topPayingCustomers}</p>
        </div>
        <span className="text-xs text-muted">{chartData.length} customers</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : isError ? (
        <div className="h-[240px] flex items-center justify-center">
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-muted">
          No revenue data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
            onClick={(state) => {
              if (state?.activePayload?.[0]?.payload?.orgId) {
                router.push(`/platform/organizations/${state.activePayload[0].payload.orgId}`);
              }
            }}
          >
            <XAxis
              type="number"
              tickFormatter={(v: number) => formatCurrency(v, true)}
              tick={{ fontSize: 11, fill: '#8B8B8B' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="orgName"
              tick={{ fontSize: 11, fill: '#585858' }}
              axisLine={false}
              tickLine={false}
              width={110}
            />
            <Tooltip content={<RevenueTooltip />} cursor={{ fill: '#F6F6F6' }} />
            <Bar dataKey="mrr" radius={[0, 4, 4, 0]} cursor="pointer" barSize={20}>
              {chartData.map((entry) => (
                <Cell key={entry.orgId} fill={PLAN_COLORS[entry.plan] ?? '#8B8B8B'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
