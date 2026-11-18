'use client';

import { useId } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useDashboardPlanDistribution } from '../../../../lib/platform-api/dashboard';
import { PLAN_COLORS, PLAN_FALLBACK_COLOR, PLAN_LABELS, PLAN_SWATCH_CLASSES, Skeleton } from '../dashboard-utils';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { ErrorState } from '../../../../components';
import { ChartFigure } from './chart-figure';

interface PlanTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: { plan: string; count: number; percentage: number };
  }>;
}

function PlanTooltip({ active, payload }: PlanTooltipProps) {
  const { t, locale } = useI18n();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-popover">
      <p className="text-body font-semibold text-primary">{PLAN_LABELS[row.plan] ?? row.plan}</p>
      <p className="text-callout text-secondary">
        {pluralize(row.count, { one: t.dashboard.customersCountOne, other: t.dashboard.customersCountOther }, locale)} (
        {row.percentage}%)
      </p>
    </div>
  );
}

export function PlanDistributionChart() {
  const { t } = useI18n();
  const d = t.dashboard;
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardPlanDistribution();

  const total = data?.reduce((s, row) => s + row.count, 0) ?? 0;
  const planName = (plan: string) => PLAN_LABELS[plan] ?? plan;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <div className="mb-4">
        <h2 id={titleId} className="text-heading font-semibold text-brand">
          {d.planDistributionTitle}
        </h2>
        <p className="text-callout text-secondary">{d.customerByPlan}</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : isError ? (
        <ErrorState size="compact" onRetry={() => refetch()} />
      ) : !data || total === 0 ? (
        <p className="py-10 text-center text-body text-secondary">{d.noSubscriptionData}</p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          {/* The donut sits centred in its own box with the total in the hole; the legend is HTML, so it
              wraps under the donut on a phone instead of clipping it. */}
          <ChartFigure
            className="relative size-[200px] shrink-0"
            summary={formatMessage(d.planSummary, {
              total,
              breakdown: data.map((row) => `${planName(row.plan)} ${row.count}`).join(', '),
            })}
            columns={[d.plan, d.customers]}
            rows={data.map((row) => ({ label: planName(row.plan), value: `${row.count} (${row.percentage}%)` }))}
          >
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="plan"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((entry) => (
                    <Cell key={entry.plan} fill={PLAN_COLORS[entry.plan] ?? PLAN_FALLBACK_COLOR} />
                  ))}
                </Pie>
                <Tooltip content={<PlanTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-title font-bold tabular-nums text-primary">{total}</span>
              <span className="text-caption text-secondary">{d.total}</span>
            </div>
          </ChartFigure>
          <ul className="flex flex-col gap-1.5" aria-hidden="true">
            {data.map((row) => (
              <li key={row.plan} className="flex items-center gap-2">
                <span
                  className={`size-2.5 shrink-0 rounded-full ${PLAN_SWATCH_CLASSES[row.plan] ?? 'bg-chart-grid'}`}
                />
                <span className="text-callout text-secondary">
                  <span className="font-medium text-primary">{planName(row.plan)}</span> · {row.count} ({row.percentage}
                  %)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
