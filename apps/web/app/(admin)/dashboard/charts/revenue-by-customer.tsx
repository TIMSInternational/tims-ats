'use client';

import { useId } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useDashboardRevenueByCustomer } from '../../../../lib/platform-api/dashboard';
import {
  formatCurrency,
  formatCurrencyTick,
  PLAN_COLORS,
  PLAN_FALLBACK_COLOR,
  PLAN_LABELS,
  Skeleton,
  truncateLabel,
} from '../dashboard-utils';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { ErrorState } from '../../../../components';
import { ChartFigure } from './chart-figure';

const TICK = { fontSize: 11, fill: 'var(--color-muted)' };
/** Height per customer row (a 20 px bar plus its gap), so every name fits beside its bar. */
const ROW_HEIGHT = 32;
/** Height of the money axis under the bars. */
const AXIS_HEIGHT = 32;

interface RevenueTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: { orgName: string; plan: string; mrr: number; userCount: number };
  }>;
}

function RevenueTooltip({ active, payload }: RevenueTooltipProps) {
  const { t, locale } = useI18n();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-white px-3 py-2 shadow-popover">
      <p className="text-body font-semibold text-primary">{row.orgName}</p>
      <dl className="mt-1 space-y-0.5 text-callout">
        <div className="flex gap-1">
          <dt className="text-secondary">{t.dashboard.plan}:</dt>
          <dd className="font-medium text-primary">{PLAN_LABELS[row.plan] ?? row.plan}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-secondary">{t.dashboard.mrr}:</dt>
          <dd className="font-medium tabular-nums text-primary">{formatCurrency(row.mrr, locale)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-secondary">{t.dashboard.colUsers}:</dt>
          <dd className="font-medium tabular-nums text-primary">{row.userCount}</dd>
        </div>
      </dl>
    </div>
  );
}

export function RevenueByCustomerChart() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const router = useRouter();
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardRevenueByCustomer();

  // Filter to only orgs with MRR > 0 for the chart
  const chartData = (data ?? []).filter((row) => row.mrr > 0).slice(0, 10);

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-heading font-semibold text-brand">
            {d.revenueByCustomer}
          </h2>
          <p className="text-callout text-secondary">{d.topPayingCustomers}</p>
        </div>
        <span className="text-callout text-secondary">
          {pluralize(chartData.length, { one: d.customersCountOne, other: d.customersCountOther }, locale)}
        </span>
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : isError ? (
        <ErrorState size="compact" onRetry={() => refetch()} />
      ) : chartData.length === 0 ? (
        <p className="py-10 text-center text-body text-secondary">{d.noRevenueData}</p>
      ) : (
        // A click on a bar is a shortcut; the customer table below is the keyboard path to each organisation.
        <ChartFigure
          summary={formatMessage(d.revenueSummary, {
            org: chartData[0].orgName,
            amount: formatCurrency(chartData[0].mrr, locale),
          })}
          columns={[d.orgName, d.mrr]}
          rows={chartData.map((row) => ({ label: row.orgName, value: formatCurrency(row.mrr, locale) }))}
        >
          <ResponsiveContainer width="100%" height={chartData.length * ROW_HEIGHT + AXIS_HEIGHT}>
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
                tickFormatter={(v: number) => formatCurrencyTick(v, locale)}
                tick={TICK}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="orgName"
                tickFormatter={(v: string) => truncateLabel(v)}
                tick={{ fontSize: 11, fill: 'var(--color-secondary)' }}
                axisLine={false}
                tickLine={false}
                width={140}
                // Every bar keeps its name: Recharts would otherwise skip every other category label.
                interval={0}
              />
              <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'var(--color-surface)' }} />
              <Bar dataKey="mrr" radius={[0, 4, 4, 0]} cursor="pointer" barSize={20}>
                {chartData.map((entry) => (
                  <Cell key={entry.orgId} fill={PLAN_COLORS[entry.plan] ?? PLAN_FALLBACK_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>
      )}
    </section>
  );
}
