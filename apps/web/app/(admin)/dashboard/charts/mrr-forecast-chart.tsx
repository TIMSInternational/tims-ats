'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { useDashboardMrrForecast } from '../../../../lib/platform-api/dashboard';
import { useId } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatCurrency, formatCurrencyTick, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';
import { ChartFigure } from './chart-figure';

const CARD = 'flex flex-col rounded-xl border border-border bg-white p-5 shadow-card';
const NAVY = 'var(--color-brand)';
const TICK = { fontSize: 11, fill: 'var(--color-muted)' };
/** Room for the longest money tick at either locale ("$120 mil", "$1.2M") without clipping. */
const AXIS_WIDTH = 64;
/** Minimum space between two month labels before one is dropped. */
const MONTH_TICK_GAP = 16;

interface ForecastTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number | null; dataKey: string }>;
  label?: string;
}

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
  const { t, locale } = useI18n();
  if (!active || !payload?.length) return null;
  const historical = payload.find((p) => p.dataKey === 'historical');
  const projected = payload.find((p) => p.dataKey === 'projected');
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-popover">
      <p className="mb-1 text-callout text-secondary">{label}</p>
      {historical?.value != null && (
        <p className="text-body font-bold tabular-nums text-primary">
          {formatCurrency(historical.value, locale)}{' '}
          <span className="text-caption font-normal text-secondary">{t.dashboard.historical}</span>
        </p>
      )}
      {projected?.value != null && (
        <p className="text-body font-bold tabular-nums text-primary">
          {formatCurrency(projected.value, locale)}{' '}
          <span className="text-caption font-normal text-secondary">{t.dashboard.projected}</span>
        </p>
      )}
    </div>
  );
}

export function MrrForecastChart() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardMrrForecast();

  if (isLoading) {
    return (
      <div className={CARD} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="mb-2 h-4 w-40" />
        <Skeleton className="mb-4 h-3 w-24" />
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CARD}>
        <ErrorState size="compact" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data) return null;

  // Merge historical + projected into chart data. A series has no value (null, not 0) outside its own
  // months, so each line stops instead of plunging to $0 at "today" (charting-data.md › Best practices).
  const chartData: { month: string; historical: number | null; projected: number | null }[] = [
    ...data.historical.map((m) => ({ month: m.month, historical: m.mrr, projected: null })),
    ...data.projected.map((m) => ({ month: m.month, historical: null, projected: m.mrr })),
  ];

  // Bridge point: the last historical month is also the projection's first anchor.
  if (data.historical.length > 0 && data.projected.length > 0) {
    const lastHistIdx = data.historical.length - 1;
    chartData[lastHistIdx].projected = chartData[lastHistIdx].historical;
  }

  const growthColor = data.monthlyGrowthPct >= 0 ? 'text-success' : 'text-danger';
  const growthSign = data.monthlyGrowthPct >= 0 ? '+' : '';
  const money = (v: number) => formatCurrency(v, locale);

  return (
    <section aria-labelledby={titleId} className={CARD}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-heading font-semibold text-brand">
            {d.mrrForecast}
          </h2>
          <p className="text-callout text-secondary">{d.forecastSubtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-title font-bold tabular-nums text-primary">{money(data.projectedArr)}</p>
          <p className="text-caption text-secondary">{d.projectedArr}</p>
        </div>
      </div>

      {/* Key metrics */}
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-caption text-secondary">{d.currentMrr}</dt>
          <dd className="text-subheading font-bold tabular-nums text-primary">{money(data.currentMrr)}</dd>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-caption text-secondary">{d.projectedMrr}</dt>
          <dd className="text-subheading font-bold tabular-nums text-primary">{money(data.projectedMrr12m)}</dd>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-caption text-secondary">{d.monthlyGrowth}</dt>
          <dd className={`text-subheading font-bold tabular-nums ${growthColor}`}>
            {growthSign}
            {data.monthlyGrowthPct}%
          </dd>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-caption text-secondary">{d.pendingTrials}</dt>
          <dd className="text-subheading font-bold tabular-nums text-primary">{data.pendingTrials}</dd>
          <dd className="text-caption tabular-nums text-secondary">
            {formatMessage(d.potentialFromTrials, { amount: money(data.potentialMrrFromTrials) })}
          </dd>
        </div>
      </dl>

      {/* Chart */}
      <ChartFigure
        summary={formatMessage(d.forecastSummary, {
          current: money(data.currentMrr),
          projected: money(data.projectedMrr12m),
        })}
        columns={[d.month, d.mrr]}
        rows={chartData.map((row) => ({
          label: row.month,
          value:
            row.historical != null
              ? `${money(row.historical)} (${d.historical})`
              : `${money(row.projected ?? 0)} (${d.projected})`,
        }))}
      >
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="historicalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={NAVY} stopOpacity={0.3} />
                <stop offset="100%" stopColor={NAVY} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
            {/* Recharts drops the month labels that would collide, so 24 months stay legible at phone width too. */}
            <XAxis
              dataKey="month"
              tick={TICK}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={MONTH_TICK_GAP}
            />
            <YAxis
              tickFormatter={(v: number) => formatCurrencyTick(v, locale)}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              width={AXIS_WIDTH}
            />
            <Tooltip content={<ForecastTooltip />} />
            <ReferenceLine
              x={data.historical[data.historical.length - 1]?.month}
              stroke="var(--color-chart-grid)"
              strokeDasharray="4 4"
              label={{ value: d.now, position: 'top', fontSize: 11, fill: 'var(--color-muted)' }}
            />
            <Area
              type="monotone"
              dataKey="historical"
              stroke={NAVY}
              strokeWidth={2}
              fill="url(#historicalGradient)"
              dot={false}
              activeDot={{ r: 3, fill: NAVY, stroke: '#fff', strokeWidth: 2 }}
              connectNulls={false}
            />
            {/* The projection is navy too (dashed, lighter fill): red means danger in this app. */}
            <Area
              type="monotone"
              dataKey="projected"
              stroke={NAVY}
              strokeWidth={2}
              strokeDasharray="6 3"
              fill={NAVY}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 3, fill: NAVY, stroke: '#fff', strokeWidth: 2 }}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFigure>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4" aria-hidden="true">
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-4 rounded bg-brand" />
          <span className="text-caption text-secondary">{d.historical}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 border-t-2 border-dashed border-brand" />
          <span className="text-caption text-secondary">{d.projected}</span>
        </div>
      </div>
    </section>
  );
}
