'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { trpc } from '../../../../lib/trpc';
import { PLAN_COLORS, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';

interface PlanTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: { plan: string; count: number; percentage: number };
  }>;
}

function PlanTooltip({ active, payload }: PlanTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-lg">
      <p className="text-sm font-semibold text-primary">{PLAN_LABELS[d.plan] ?? d.plan}</p>
      <p className="text-xs text-muted">
        {d.count} customer{d.count !== 1 ? 's' : ''} ({d.percentage}%)
      </p>
    </div>
  );
}

interface LegendEntryProps {
  value: string;
  color?: string;
}

function CustomLegend({ payload }: { payload?: Array<LegendEntryProps> }) {
  if (!payload) return null;
  return (
    <div className="flex flex-col gap-1.5 ml-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-secondary">{PLAN_LABELS[entry.value] ?? entry.value}</span>
        </div>
      ))}
    </div>
  );
}

interface CenterLabelProps {
  cx: number;
  cy: number;
  total: number;
}

function CenterLabel({ cx, cy, total }: CenterLabelProps) {
  return (
    <g>
      <text x={cx} y={cy - 6} textAnchor="middle" className="fill-primary text-lg font-bold">
        {total}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted text-[10px]">
        total
      </text>
    </g>
  );
}

export function PlanDistributionChart() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.platform.getPlanDistribution.useQuery();

  const total = data?.reduce((s, d) => s + d.count, 0) ?? 0;

  return (
    <div className="rounded-xl border border-border bg-white p-5 flex flex-col">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-primary">{t.dashboard.planDistributionTitle}</h3>
        <p className="text-xs text-muted">{t.dashboard.customerByPlan}</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : isError ? (
        <div className="h-[240px] flex items-center justify-center">
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : !data || total === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-muted">
          No subscription data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="plan"
              cx="40%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.plan} fill={PLAN_COLORS[entry.plan] ?? '#8B8B8B'} />
              ))}
              <CenterLabel cx={0} cy={0} total={total} />
            </Pie>
            <Tooltip content={<PlanTooltip />} />
            <Legend
              content={<CustomLegend />}
              layout="vertical"
              align="right"
              verticalAlign="middle"
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
