'use client';

import { trpc } from '../../../lib/trpc';
import { useDashboardRecentActivity } from '../../../lib/platform-api/dashboard';
import { timeAgo, Skeleton } from './dashboard-utils';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';

const ACTIVITY_ICONS: Record<string, { icon: string; color: string }> = {
  org_created: { icon: '\u{1F3E2}', color: 'bg-emerald-100' },
  user_created: { icon: '\u{1F464}', color: 'bg-violet-100' },
  platform_owner: { icon: '\u{1F451}', color: 'bg-blue-100' },
  plan_upgrade: { icon: '\u{2B06}', color: 'bg-blue-100' },
  payment_failed: { icon: '\u{26A0}', color: 'bg-red-100' },
  trial_expiring: { icon: '\u{23F3}', color: 'bg-amber-100' },
  default: { icon: '\u{1F4CB}', color: 'bg-gray-100' },
};

function ActivityIcon({ type }: { type: string }) {
  const cfg = ACTIVITY_ICONS[type] ?? ACTIVITY_ICONS.default;
  return (
    <span className={`h-7 w-7 rounded-full ${cfg.color} flex items-center justify-center text-xs shrink-0`}>
      {cfg.icon}
    </span>
  );
}

function ServiceDot({ status, label, latency }: { status: string; label: string; latency?: string }) {
  const dotColor = status === 'operational' ? 'bg-emerald-500' : status === 'degraded' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-xs text-secondary">{label}</span>
      </div>
      {latency && <span className="text-[10px] text-muted">{latency}</span>}
    </div>
  );
}

export function ActivityFeed() {
  const { t } = useI18n();
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Recent Activity */}
      <div className="rounded-xl border border-border bg-white p-5 flex flex-col">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-primary">{t.dashboard.recentActivity}</h3>
          <p className="text-xs text-muted">{t.dashboard.latestPlatformEvents}</p>
        </div>

        {actLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-3/4 mb-1" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : actError ? (
          <ErrorState onRetry={() => refetchActivity()} />
        ) : (
          <div className="space-y-1 overflow-y-auto max-h-[260px]">
            {(activity ?? []).slice(0, 10).map((item) => (
              <div key={item.id} className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-surface/50">
                <ActivityIcon type={item.type} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-primary truncate">{item.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.meta && <span className="text-[10px] text-muted truncate max-w-[120px]">{item.meta}</span>}
                    <span className="text-[10px] text-muted">{timeAgo(item.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
            {(!activity || activity.length === 0) && (
              <p className="text-xs text-muted py-6 text-center">{t.dashboard.noRecentActivity}</p>
            )}
          </div>
        )}
      </div>

      {/* System Status */}
      <div className="rounded-xl border border-border bg-white p-5 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-primary">{t.dashboard.systemStatus}</h3>
            <p className="text-xs text-muted">{t.dashboard.serviceHealthOverview}</p>
          </div>
          {health && (
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                health.overall === 'operational' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {health.overall === 'operational' ? 'All Systems Go' : 'Degraded'}
            </span>
          )}
        </div>

        {healthLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : healthError ? (
          <ErrorState onRetry={() => refetchHealth()} />
        ) : (
          <div className="space-y-0 overflow-y-auto max-h-[260px]">
            {(health?.services ?? []).slice(0, 8).map((svc) => {
              const latencyMetric = svc.metrics?.find(
                (m) => m.label.toLowerCase().includes('latencia') || m.label.toLowerCase().includes('query'),
              );
              return <ServiceDot key={svc.name} status={svc.status} label={svc.name} latency={latencyMetric?.value} />;
            })}
            {health?.services.length === 0 && (
              <p className="text-xs text-muted py-6 text-center">{t.dashboard.noServicesFound}</p>
            )}
          </div>
        )}

        {/* Stats summary */}
        {health?.stats && (
          <div className="mt-auto pt-3 border-t border-border grid grid-cols-2 gap-2">
            <div className="text-center">
              <p className="text-lg font-bold text-primary">{health.stats.loginsToday}</p>
              <p className="text-[10px] text-muted">{t.dashboard.loginsToday}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-primary">{health.stats.auditLogsToday}</p>
              <p className="text-[10px] text-muted">{t.dashboard.eventsToday}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
