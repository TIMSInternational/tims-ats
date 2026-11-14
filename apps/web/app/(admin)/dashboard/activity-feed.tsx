'use client';

import { useId } from 'react';
import { trpc } from '../../../lib/trpc';
import { useDashboardRecentActivity } from '../../../lib/platform-api/dashboard';
import { Skeleton } from './dashboard-utils';
import { useI18n } from '../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../lib/format-utils';
import { ErrorState } from '../../../components';
import { StatusBadge, type StatusTone } from '../../../components/status-badge';

// Heroicons outline paths (the shell's icon set), one per activity type; emoji rendered differently per OS
// and were read aloud ("office building"), so the icon is decorative and the title carries the meaning.
const ACTIVITY_ICONS: Record<string, string> = {
  org_created:
    'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
  user_created:
    'M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z',
  platform_owner:
    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  plan_upgrade: 'M15 11.25l-3-3m0 0l-3 3m3-3v7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  payment_failed:
    'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  trial_expiring: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  default:
    'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
};

function ActivityIcon({ type }: { type: string }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand"
      aria-hidden="true"
    >
      <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d={ACTIVITY_ICONS[type] ?? ACTIVITY_ICONS.default} />
      </svg>
    </span>
  );
}

const STATUS_TONE: Record<string, StatusTone> = {
  operational: 'success',
  degraded: 'warning',
  down: 'danger',
};

/** One service: its name, its status as a word (never a dot alone), and its latency. */
function ServiceRow({
  label,
  statusLabel,
  tone,
  latency,
}: {
  label: string;
  statusLabel: string;
  tone: StatusTone;
  latency?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-callout text-primary">{label}</span>
        <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
      </div>
      {latency && <span className="shrink-0 text-caption tabular-nums text-muted">{latency}</span>}
    </li>
  );
}

export function ActivityFeed() {
  const { t, locale } = useI18n();
  const activityId = useId();
  const statusId = useId();
  const statusWord = (status: string) =>
    status === 'operational'
      ? t.health.statusOperational
      : status === 'down'
        ? t.health.statusDown
        : status === 'degraded'
          ? t.health.statusDegraded
          : t.health.statusUnmonitored;
  const {
    data: activity,
    isLoading: actLoading,
    isError: actError,
    refetch: refetchActivity,
  } = useDashboardRecentActivity();
  const {
    data: health,
    isLoading: healthLoading,
    isError: healthError,
    refetch: refetchHealth,
  } = trpc.platform.getSystemHealth.useQuery();

  const card = 'flex flex-col rounded-xl border border-border bg-white p-5 shadow-card';

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Recent Activity */}
      <section aria-labelledby={activityId} className={card}>
        <div className="mb-4">
          <h2 id={activityId} className="text-heading font-semibold text-brand">
            {t.dashboard.recentActivity}
          </h2>
          <p className="text-callout text-secondary">{t.dashboard.latestPlatformEvents}</p>
        </div>

        {actLoading ? (
          <div className="space-y-3" aria-busy="true">
            <span className="sr-only">{t.common.loadingContent}</span>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-7 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="mb-1 h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : actError ? (
          <ErrorState size="compact" onRetry={() => refetchActivity()} />
        ) : !activity || activity.length === 0 ? (
          <p className="py-6 text-center text-body text-secondary">{t.dashboard.noRecentActivity}</p>
        ) : (
          <ul className="max-h-[260px] space-y-1 overflow-y-auto">
            {activity.slice(0, 10).map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-lg px-1 py-2">
                <ActivityIcon type={item.type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-callout font-medium text-primary">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                    {item.meta && <span className="max-w-40 truncate text-caption text-muted">{item.meta}</span>}
                    <span className="text-caption text-muted">
                      {formatRelativeTimeLocale(item.timestamp, locale, t.dashboard.never)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* System Status */}
      <section aria-labelledby={statusId} className={card}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id={statusId} className="text-heading font-semibold text-brand">
              {t.dashboard.systemStatus}
            </h2>
            <p className="text-callout text-secondary">{t.dashboard.serviceHealthOverview}</p>
          </div>
          {health && (
            <StatusBadge tone={STATUS_TONE[health.overall] ?? 'neutral'}>{statusWord(health.overall)}</StatusBadge>
          )}
        </div>

        {healthLoading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">{t.common.loadingContent}</span>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : healthError ? (
          <ErrorState size="compact" onRetry={() => refetchHealth()} />
        ) : health?.services.length === 0 ? (
          <p className="py-6 text-center text-body text-secondary">{t.dashboard.noServicesFound}</p>
        ) : (
          <ul className="max-h-[260px] overflow-y-auto">
            {(health?.services ?? []).slice(0, 8).map((svc) => {
              const latencyMetric = svc.metrics?.find((m) => m.id === 'query_time' || m.id === 'api_latency');
              return (
                <ServiceRow
                  key={svc.id}
                  label={t.health.serviceNames[svc.id]}
                  statusLabel={statusWord(svc.status)}
                  tone={STATUS_TONE[svc.status] ?? 'neutral'}
                  latency={latencyMetric?.value ?? undefined}
                />
              );
            })}
          </ul>
        )}

        {/* Stats summary */}
        {health?.stats && (
          <dl className="mt-auto grid grid-cols-2 gap-2 border-t border-border pt-3">
            <div className="flex flex-col-reverse text-center">
              <dt className="text-caption text-secondary">{t.dashboard.loginsToday}</dt>
              <dd className="font-display text-title font-bold tabular-nums text-primary">
                {health.stats.loginsToday ?? '\u2014'}
              </dd>
            </div>
            <div className="flex flex-col-reverse text-center">
              <dt className="text-caption text-secondary">{t.dashboard.eventsToday}</dt>
              <dd className="font-display text-title font-bold tabular-nums text-primary">
                {health.stats.auditLogsToday ?? '\u2014'}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
