'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { trpc } from '../../../../lib/trpc';
import { formatCurrency, BRAND_NAVY, Skeleton } from '../dashboard-utils';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';

interface MrrTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function MrrTooltip({ active, payload, label }: MrrTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-lg">
      <p className="text-xs text-muted mb-0.5">{label}</p>
      <p className="text-sm font-bold text-primary">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

export function MrrTrendChart() {
  const { data, isLoading, isError, refetch } = trpc.platform.getMrrTrend.useQuery();
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-border bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-primary">{t.dashboard.mrrTrendTitle}</h3>
          <p className="text-xs text-muted">{t.dashboard.mrrTrendSubtitle}</p>
        </div>
        {data && data.length > 0 && (
          <span className="text-lg font-bold text-primary">
            {formatCurrency(data[data.length - 1].mrr)}
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data ?? []} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
            <defs>
              <linearGradient id="mrrGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BRAND_NAVY} stopOpacity={0.4} />
                <stop offset="100%" stopColor={BRAND_NAVY} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: '#8B8B8B' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => formatCurrency(v, true)}
              tick={{ fontSize: 11, fill: '#8B8B8B' }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <Tooltip content={<MrrTooltip />} />
            <Area
              type="monotone"
              dataKey="mrr"
              stroke={BRAND_NAVY}
              strokeWidth={2}
              fill="url(#mrrGradient)"
              dot={false}
              activeDot={{ r: 4, fill: BRAND_NAVY, stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
