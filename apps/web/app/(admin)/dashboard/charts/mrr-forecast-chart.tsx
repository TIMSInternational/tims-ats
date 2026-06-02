'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, BRAND_NAVY, Skeleton } from '../dashboard-utils';

interface ForecastTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const historical = payload.find((p) => p.dataKey === 'historical');
  const projected = payload.find((p) => p.dataKey === 'projected');
  return (
    <div className="rounded-lg border border-[#EDEDED] bg-white px-3 py-2 shadow-lg">
      <p className="text-xs text-[#8B8B8B] mb-1">{label}</p>
      {historical && historical.value > 0 && (
        <p className="text-sm font-bold text-[#1F114C]">{formatCurrency(historical.value)} <span className="text-[10px] font-normal text-[#8B8B8B]">{t.dashboard.historical}</span></p>
      )}
      {projected && projected.value > 0 && (
        <p className="text-sm font-bold text-[#DD0C15]">{formatCurrency(projected.value)} <span className="text-[10px] font-normal text-[#8B8B8B]">{t.dashboard.projected}</span></p>
      )}
    </div>
  );
}

export function MrrForecastChart() {
  const { t } = useI18n();
  const { data, isLoading } = trpc.platform.getMrrForecast.useQuery();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <Skeleton className="h-4 w-40 mb-2" />
        <Skeleton className="h-3 w-24 mb-4" />
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  if (!data) return null;

  // Merge historical + projected into chart data
  // Last historical month is also first projected anchor
  const chartData = [
    ...data.historical.map((m) => ({
      month: m.month,
      historical: m.mrr,
      projected: 0,
    })),
    // Overlap: last historical = first projected anchor
    ...data.projected.map((m) => ({
      month: m.month,
      historical: 0,
      projected: m.mrr,
    })),
  ];

  // Set the bridge point: last historical month also gets projected value
  if (data.historical.length > 0 && data.projected.length > 0) {
    const lastHistIdx = data.historical.length - 1;
    chartData[lastHistIdx].projected = chartData[lastHistIdx].historical;
  }

  const growthColor = data.monthlyGrowthPct >= 0 ? 'text-emerald-600' : 'text-[#DD0C15]';
  const growthSign = data.monthlyGrowthPct >= 0 ? '+' : '';

  return (
    <div className="rounded-xl border border-[#EDEDED] bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-[#1F114C]">{t.dashboard.mrrForecast}</h3>
          <p className="text-xs text-[#8B8B8B]">12m {t.dashboard.historical} + 12m {t.dashboard.projected}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-[#1F114C]">{formatCurrency(data.projectedArr)}</p>
          <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.projectedArr}</p>
        </div>
      </div>

      {/* Key metrics strip */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 bg-[#F6F6F6] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.currentMrr}</p>
          <p className="text-sm font-bold text-[#1F114C]">{formatCurrency(data.currentMrr)}</p>
        </div>
        <div className="flex-1 bg-[#F6F6F6] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.projectedMrr}</p>
          <p className="text-sm font-bold text-[#DD0C15]">{formatCurrency(data.projectedMrr12m)}</p>
        </div>
        <div className="flex-1 bg-[#F6F6F6] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.monthlyGrowth}</p>
          <p className={`text-sm font-bold ${growthColor}`}>{growthSign}{data.monthlyGrowthPct}%</p>
        </div>
        <div className="flex-1 bg-[#F6F6F6] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.pendingTrials}</p>
          <p className="text-sm font-bold text-amber-600">{data.pendingTrials}</p>
          <p className="text-[9px] text-[#8B8B8B]">+{formatCurrency(data.potentialMrrFromTrials)}</p>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id="historicalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND_NAVY} stopOpacity={0.3} />
              <stop offset="100%" stopColor={BRAND_NAVY} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="projectedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#DD0C15" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#DD0C15" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: '#8B8B8B' }}
            axisLine={false}
            tickLine={false}
            interval={2}
          />
          <YAxis
            tickFormatter={(v: number) => formatCurrency(v, true)}
            tick={{ fontSize: 10, fill: '#8B8B8B' }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip content={<ForecastTooltip />} />
          <ReferenceLine
            x={data.historical[data.historical.length - 1]?.month}
            stroke="#EDEDED"
            strokeDasharray="4 4"
            label={{ value: 'Now', position: 'top', fontSize: 10, fill: '#8B8B8B' }}
          />
          <Area
            type="monotone"
            dataKey="historical"
            stroke={BRAND_NAVY}
            strokeWidth={2}
            fill="url(#historicalGradient)"
            dot={false}
            activeDot={{ r: 3, fill: BRAND_NAVY, stroke: '#fff', strokeWidth: 2 }}
            connectNulls={false}
          />
          <Area
            type="monotone"
            dataKey="projected"
            stroke="#DD0C15"
            strokeWidth={2}
            strokeDasharray="6 3"
            fill="url(#projectedGradient)"
            dot={false}
            activeDot={{ r: 3, fill: '#DD0C15', stroke: '#fff', strokeWidth: 2 }}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-[#1F114C] rounded" />
          <span className="text-[10px] text-[#8B8B8B]">{t.dashboard.historical}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-[#DD0C15] rounded" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #DD0C15 0 6px, transparent 6px 9px)' }} />
          <span className="text-[10px] text-[#8B8B8B]">{t.dashboard.projected}</span>
        </div>
      </div>
    </div>
  );
}
