'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../../lib/format-utils';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, type StatusTone } from '../../../../components';

export function SystemInfo() {
  const { t, locale } = useI18n();
  const {
    data: health,
    isLoading: healthLoading,
    isError: healthError,
    error: healthLoadError,
    refetch: refetchHealth,
  } = trpc.platform.getSystemHealth.useQuery(undefined, { refetchInterval: 30_000 });
  const {
    data: events,
    isLoading: eventsLoading,
    isError: eventsError,
    error: eventsLoadError,
    refetch: refetchEvents,
  } = trpc.platform.getRecentPlatformEvents.useQuery({ limit: 10 }, { refetchInterval: 30_000 });

  const statusTone = (status: string): StatusTone =>
    status === 'operational' ? 'success' : status === 'degraded' ? 'warning' : status === 'down' ? 'danger' : 'neutral';

  const statusLabel = (status: string) =>
    status === 'operational'
      ? t.health.statusOperational
      : status === 'degraded'
        ? t.health.statusDegraded
        : status === 'down'
          ? t.health.statusDown
          : t.health.statusUnmonitored;
  const actions = t.audit.actions as Record<string, string>;
  const entities = t.audit.entities as Record<string, string>;
  const TH = 'pb-2 text-left text-callout font-medium text-secondary';

  return (
    <section aria-labelledby="system-info-title" className="rounded-xl bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="system-info-title" className="text-heading font-semibold text-brand">
          {t.support.systemInfo}
        </h2>
        <Button href="/platform/health" variant="tertiary" size="sm">
          {t.support.viewHealth}
        </Button>
      </div>

      {healthLoading ? (
        <div aria-busy="true" className="mb-5 space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-lg" />
          ))}
        </div>
      ) : healthError ? (
        <ErrorState size="compact" onRetry={() => refetchHealth()} error={healthLoadError} message={t.health.loadError} />
      ) : health ? (
        <>
          <div className="mb-4">
            <StatusBadge tone={statusTone(health.overall)}>
              {health.overall === 'operational'
                ? t.support.allOperational
                : health.overall === 'down'
                  ? t.support.someDown
                  : health.overall === 'degraded'
                    ? t.support.someDegraded
                    : t.support.monitoringIncomplete}
            </StatusBadge>
          </div>
          <dl className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: t.support.users, value: health.stats.userCount },
              { label: t.support.orgs, value: health.stats.orgCount },
              { label: t.support.loginsToday, value: health.stats.loginsToday },
              {
                label: t.support.dbLatency,
                value: health.services.find((s) => s.id === 'database')?.metrics.find((m) => m.id === 'query_time')
                  ?.value,
              },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse rounded-lg bg-surface p-3 text-center">
                <dt className="text-callout text-secondary">{stat.label}</dt>
                <dd className="text-title font-semibold tabular-nums text-primary">{stat.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mb-2 text-subheading font-semibold text-primary">{t.support.services}</h3>
          <ul className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {health.services.map((svc) => (
              <li key={svc.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-body font-medium text-primary">
                  {t.health.serviceNames[svc.id]}
                </span>
                <StatusBadge tone={statusTone(svc.status)} className="shrink-0">
                  {statusLabel(svc.status)}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="mb-2 text-subheading font-semibold text-primary">{t.support.recentEvents}</h3>
      {eventsLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-lg" />
          ))}
        </div>
      ) : eventsError ? (
        <ErrorState size="compact" onRetry={() => refetchEvents()} error={eventsLoadError} message={t.support.eventsLoadError} />
      ) : events && events.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>{t.support.colTime}</th>
                <th className={TH}>{t.support.colActor}</th>
                <th className={TH}>{t.support.colAction}</th>
                <th className={TH}>{t.support.colEntity}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((evt) => (
                <tr key={evt.id}>
                  <td className="whitespace-nowrap py-2 text-callout text-secondary">
                    {formatRelativeTimeLocale(evt.createdAt, locale)}
                  </td>
                  <td className="max-w-[160px] truncate py-2 text-body text-primary">
                    {evt.actor
                      ? `${evt.actor.firstName || ''} ${evt.actor.lastName || ''}`.trim() || evt.actor.email
                      : t.support.system}
                  </td>
                  <td className="py-2 text-body text-primary">{actions[evt.action] ?? evt.action}</td>
                  <td className="py-2 text-body text-secondary">
                    {evt.entity ? (entities[evt.entity] ?? evt.entity) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState size="compact" title={t.support.noEvents} description={t.support.noEventsDesc} />
      )}
    </section>
  );
}
