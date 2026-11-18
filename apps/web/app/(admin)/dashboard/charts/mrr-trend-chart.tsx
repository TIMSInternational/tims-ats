'use client';

import { useId } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useDashboardMrrTrend } from '../../../../lib/platform-api/dashboard';
import { formatCurrency, formatCurrencyTick, Skeleton } from '../dashboard-utils';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { ErrorState } from '../../../../components';
import { ChartFigure } from './chart-figure';

const NAVY = 'var(--color-brand)';
const TICK = { fontSize: 11, fill: 'var(--color-muted)' };
/** Room for the longest money tick at either locale ("$120 mil", "$1.2M") without clipping. */
const AXIS_WIDTH = 64;

interface MrrTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function MrrTooltip({ active, payload, label }: MrrTooltipProps) {
  const { locale } = useI18n();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-popover">
      <p className="mb-0.5 text-callout text-secondary">{label}</p>
      <p className="text-body font-bold tabular-nums text-primary">{formatCurrency(payload[0].value, locale)}</p>
    </div>
  );
}

export function MrrTrendChart() {
  const { data, isLoading, isError, refetch } = useDashboardMrrTrend();
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const titleId = useId();
  const series = data ?? [];
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-heading font-semibold text-brand">
            {d.mrrTrendTitle}
          </h2>
          <p className="text-callout text-secondary">{d.mrrTrendSubtitle}</p>
        </div>
        {last && (
          <span className="text-title font-bold tabular-nums text-primary">{formatCurrency(last.mrr, locale)}</span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : isError ? (
        <ErrorState size="compact" onRetry={() => refetch()} />
      ) : (
        <ChartFigure
          summary={
            first && last
              ? formatMessage(d.mrrTrendSummary, {
                  from: formatCurrency(first.mrr, locale),
                  to: formatCurrency(last.mrr, locale),
                  months: series.length,
                })
              : d.noRevenueData
          }
          columns={[d.month, d.mrr]}
          rows={series.map((m) => ({ label: m.month, value: formatCurrency(m.mrr, locale) }))}
        >
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="mrrGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NAVY} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={NAVY} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
              <XAxis dataKey="month" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => formatCurrencyTick(v, locale)}
                tick={TICK}
                axisLine={false}
                tickLine={false}
                width={AXIS_WIDTH}
              />
              <Tooltip content={<MrrTooltip />} />
              <Area
                type="monotone"
                dataKey="mrr"
                stroke={NAVY}
                strokeWidth={2}
                fill="url(#mrrGradient)"
                dot={false}
                activeDot={{ r: 4, fill: NAVY, stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFigure>
      )}
    </section>
  );
}
