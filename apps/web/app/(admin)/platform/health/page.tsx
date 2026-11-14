'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatNumber } from '../../../../lib/format-utils';
import { ErrorState, KpiCard, PageHeader, Skeleton, StatusBadge, type StatusTone } from '../../../../components';
import { HealthStatusBanner } from './health-status-banner';
import { HealthRefresh } from './health-refresh';
import { LatencyCard } from './latency-card';
import { RecentErrorsCard } from './recent-errors-card';

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'unmonitored';

const STATUS_TONE: Record<ServiceStatus, StatusTone> = {
  operational: 'success',
  degraded: 'warning',
  down: 'danger',
  unmonitored: 'neutral',
};

// A coloured metric also gets a word, so the state never rests on colour alone.
const METRIC_TONE: Record<string, StatusTone> = { green: 'success', amber: 'warning', red: 'danger' };

export default function PlatformHealthPage() {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } =
    trpc.platform.getSystemHealth.useQuery(undefined, {
      refetchInterval: 30000,
    });

  const statusLabel: Record<ServiceStatus, string> = {
    operational: t.health.statusOperational,
    degraded: t.health.statusDegraded,
    down: t.health.statusDown,
    unmonitored: t.health.statusUnmonitored,
  };
  const metricWord: Record<string, string> = {
    green: t.health.metricOk,
    amber: t.health.metricSlow,
    red: t.health.metricCritical,
  };

  const services = data?.services ?? [];
  const overall = data?.overall ?? 'unmonitored';
  // null = the feed could not be read (DB down) — shown as unavailable, never as "no errors".
  const recentErrors = data?.recentErrors ?? null;
  const stats = data?.stats;
  const count = (value: number | null | undefined) => (value == null ? '—' : formatNumber(value, locale));

  const header = (
    <PageHeader
      title={t.platformSidebar.systemHealth}
      actions={
        !isLoading && !isError ? (
          <HealthRefresh dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => refetch()} />
        ) : undefined
      }
    />
  );

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div aria-busy="true" className="flex-1 space-y-3 overflow-y-auto p-4 md:p-6">
          <span className="sr-only">{t.health.loading}</span>
          <Skeleton className="h-20 rounded-xl" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="rounded-xl bg-white shadow-card">
            <ErrorState onRetry={() => refetch()} error={error} message={t.health.loadError} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 md:p-6">
        <HealthStatusBanner overall={overall} services={services} />

        {stats && (
          <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={t.health.totalUsers} value={count(stats.userCount)} />
            <KpiCard label={t.health.organizations} value={count(stats.orgCount)} />
            <KpiCard label={t.health.loginsToday} value={count(stats.loginsToday)} />
            <KpiCard label={t.health.eventsToday} value={count(stats.auditLogsToday)} />
          </div>
        )}

        <ul className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => {
            const status =
              (service.status as ServiceStatus) in STATUS_TONE ? (service.status as ServiceStatus) : 'unmonitored';
            return (
              <li key={service.id} className="rounded-xl bg-white p-4 shadow-card">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h2 className="min-w-0 text-body font-semibold text-brand">{t.health.serviceNames[service.id]}</h2>
                  <StatusBadge tone={STATUS_TONE[status]} className="shrink-0">
                    {statusLabel[status]}
                  </StatusBadge>
                </div>
                <dl className="space-y-2">
                  {service.metrics?.map((metric) => {
                    const color = 'color' in metric && metric.color ? metric.color : null;
                    return (
                      <div key={metric.id} className="flex items-center justify-between gap-2">
                        <dt className="text-callout text-secondary">{t.health.metricLabels[metric.id]}</dt>
                        <dd className="flex items-center gap-1.5 text-body font-medium tabular-nums text-primary">
                          {metric.value ?? t.health.notAvailable}
                          {color && METRIC_TONE[color] && (
                            <StatusBadge tone={METRIC_TONE[color]}>{metricWord[color]}</StatusBadge>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            );
          })}
        </ul>

        <div className="grid min-h-[260px] flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
          <LatencyCard />
          <RecentErrorsCard recentErrors={recentErrors} />
        </div>
      </div>
    </div>
  );
}
