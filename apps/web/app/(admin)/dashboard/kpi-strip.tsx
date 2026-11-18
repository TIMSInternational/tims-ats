'use client';

import { useDashboardKpis, useDashboardMrrTrend } from '../../../lib/platform-api/dashboard';
import { formatCurrency, trendArrow, Skeleton } from './dashboard-utils';
import { ErrorState } from '../../../components';
import { StatusBadge, type StatusTone } from '../../../components/status-badge';
import { useI18n } from '../../../lib/i18n';
import { formatMessage } from '../../../lib/i18n/format';

interface SparklineProps {
  data: number[];
  height?: number;
}

// Decorative: the number beside it carries the value (charts.md › accessibility), so it is aria-hidden.
function Sparkline({ data, height = 28 }: SparklineProps) {
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
    <svg width={w} height={height} className="ml-auto shrink-0 text-brand" aria-hidden="true" focusable="false">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
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
  /** Arrow only when the figure actually moved. */
  direction?: 'up' | 'down' | 'none';
  sparkData?: number[];
  badge?: { text: string; tone: StatusTone } | null;
}

function KpiCard({ label, value, trendLabel, trendColor, direction = 'none', sparkData, badge }: KpiCardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-callout font-medium text-secondary">{label}</span>
        {badge && <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-title font-bold tabular-nums tracking-tight text-primary md:text-display">
            {value}
          </p>
          <span className={`text-callout font-medium ${trendColor}`}>
            {direction === 'up' && <span aria-hidden="true">{'\u2191'} </span>}
            {direction === 'down' && <span aria-hidden="true">{'\u2193'} </span>}
            {trendLabel}
          </span>
        </div>
        {sparkData && sparkData.length > 1 && <Sparkline data={sparkData} />}
      </div>
    </div>
  );
}

const DIRECTION: Record<number, 'up' | 'down' | 'none'> = { 1: 'up', [-1]: 'down', 0: 'none' };

export function KpiStrip() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const { data: kpis, isLoading, isError, refetch } = useDashboardKpis();
  const { data: mrrTrend, isError: mrrTrendError, refetch: refetchMrrTrend } = useDashboardMrrTrend();

  if (isLoading) {
    return (
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4" aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
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
          size="compact"
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

  const delta = (n: number) => (n > 0 ? 'text-success' : 'text-muted');
  const dir = (n: number): 'up' | 'down' | 'none' => DIRECTION[Math.sign(n)] ?? 'none';
  const thisMonth = (n: number) => formatMessage(d.thisMonthCount, { count: n > 0 ? `+${n}` : String(n) });

  return (
    <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
      <KpiCard
        label={d.mrr}
        value={formatCurrency(kpis.mrr, locale)}
        trendLabel={mrrChange.label}
        trendColor={mrrChange.color}
        direction={mrrChange.direction}
        sparkData={mrrTrendData}
      />
      {/* No sparkline: there is no customer-count series yet, and an interpolated line is not data. */}
      <KpiCard
        label={d.kpiCustomers}
        value={String(kpis.totalOrgs)}
        trendLabel={thisMonth(kpis.totalOrgsChange)}
        trendColor={delta(kpis.totalOrgsChange)}
        direction={dir(kpis.totalOrgsChange)}
      />
      <KpiCard
        label={d.kpiActiveUsers}
        value={String(kpis.totalUsers)}
        trendLabel={thisMonth(kpis.totalUsersChange)}
        trendColor={delta(kpis.totalUsersChange)}
        direction={dir(kpis.totalUsersChange)}
        badge={
          kpis.activeTrials > 0
            ? { text: formatMessage(d.trialsCount, { count: kpis.activeTrials }), tone: 'warning' }
            : null
        }
      />
      {/* An amount, not a trend: no arrow; the overdue count is the status line. */}
      <KpiCard
        label={d.kpiOutstanding}
        value={formatCurrency(kpis.outstandingAmount, locale)}
        trendLabel={formatMessage(d.overdueCount, { count: kpis.overdueInvoices })}
        trendColor={kpis.overdueInvoices > 0 ? 'text-danger' : 'text-muted'}
      />
    </div>
  );
}
