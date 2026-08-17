'use client';

import { useDashboardKpis, useDashboardMrrTrend } from '../../../lib/platform-api/dashboard';
import { formatCurrency, trendArrow, Skeleton } from './dashboard-utils';
import { ErrorState } from '../../../components';

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
}

function Sparkline({ data, color, height = 28 }: SparklineProps) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 80;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={w} height={height} className="ml-auto shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  trendLabel: string;
  trendColor: string;
  trendUp: boolean;
  sparkData?: number[];
  sparkColor?: string;
  badge?: { text: string; color: string } | null;
}

function KpiCard({ label, value, trendLabel, trendColor, trendUp, sparkData, sparkColor, badge }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">{label}</span>
        {badge && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>
            {badge.text}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xl md:text-2xl font-bold text-primary tracking-tight">{value}</p>
          <span className={`text-xs font-medium ${trendColor}`}>
            {trendUp ? '\u2191' : '\u2193'} {trendLabel}
          </span>
        </div>
        {sparkData && sparkData.length > 1 && <Sparkline data={sparkData} color={sparkColor ?? '#1F114C'} />}
      </div>
    </div>
  );
}

export function KpiStrip() {
  const { data: kpis, isLoading, isError, refetch } = useDashboardKpis();
  const { data: mrrTrend, isError: mrrTrendError, refetch: refetchMrrTrend } = useDashboardMrrTrend();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-white p-4">
            <Skeleton className="h-3 w-16 mb-3" />
            <Skeleton className="h-7 w-24 mb-2" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || mrrTrendError) {
    return (
      <div className="mb-5">
        <ErrorState
          onRetry={() => {
            refetch();
            refetchMrrTrend();
          }}
        />
      </div>
    );
  }

  if (!kpis) return null;

  const mrrTrendData = mrrTrend?.map((m) => m.mrr) ?? [];
  const mrrChange = trendArrow(kpis.mrr, kpis.mrrPrevMonth);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
      <KpiCard
        label="MRR"
        value={formatCurrency(kpis.mrr)}
        trendLabel={mrrChange.label}
        trendColor={mrrChange.color}
        trendUp={mrrChange.up}
        sparkData={mrrTrendData}
        sparkColor="#1F114C"
      />
      <KpiCard
        label="Customers"
        value={String(kpis.totalOrgs)}
        trendLabel={`+${kpis.totalOrgsChange} this month`}
        trendColor={kpis.totalOrgsChange > 0 ? 'text-emerald-600' : 'text-muted'}
        trendUp={kpis.totalOrgsChange > 0}
        sparkData={mrrTrend?.map(
          (_, i) =>
            kpis.totalOrgs -
            kpis.totalOrgsChange +
            Math.floor(i * (kpis.totalOrgsChange / Math.max(mrrTrend.length - 1, 1))),
        )}
        sparkColor="#8B5CF6"
      />
      <KpiCard
        label="Active Users"
        value={String(kpis.totalUsers)}
        trendLabel={`+${kpis.totalUsersChange} this month`}
        trendColor={kpis.totalUsersChange > 0 ? 'text-emerald-600' : 'text-muted'}
        trendUp={kpis.totalUsersChange > 0}
        sparkColor="#3B82F6"
        badge={
          kpis.activeTrials > 0 ? { text: `${kpis.activeTrials} trials`, color: 'bg-amber-100 text-amber-700' } : null
        }
      />
      <KpiCard
        label="Outstanding"
        value={formatCurrency(kpis.outstandingAmount)}
        trendLabel={`${kpis.overdueInvoices} overdue`}
        trendColor={kpis.overdueInvoices > 0 ? 'text-red-600' : 'text-muted'}
        trendUp={false}
        sparkColor="#DD0C15"
        badge={
          kpis.overdueInvoices > 0
            ? { text: `${kpis.overdueInvoices} overdue`, color: 'bg-red-100 text-red-700' }
            : null
        }
      />
    </div>
  );
}
