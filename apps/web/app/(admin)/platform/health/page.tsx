'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatRelativeTime } from '../../../../lib/format-utils';
import { ErrorState } from '../../../../components';
import { HealthStatusBanner } from './health-status-banner';

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'unmonitored';

const METRIC_COLORS: Record<string, string> = {
  green: 'text-green-600',
  red: 'text-[#DD0C15]',
  amber: 'text-amber-600',
};

export default function PlatformHealthPage() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch, dataUpdatedAt } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const statusConfig: Record<
    ServiceStatus,
    { dot: string; badge: string; badgeText: string; label: string; ring?: string }
  > = {
    operational: {
      dot: 'bg-green-500',
      badge: 'bg-green-100',
      badgeText: 'text-green-700',
      label: t.health.statusOperational,
    },
    degraded: {
      dot: 'bg-amber-500',
      badge: 'bg-amber-100',
      badgeText: 'text-amber-700',
      label: t.health.statusDegraded,
      ring: 'ring-1 ring-amber-200',
    },
    down: {
      dot: 'bg-red-500',
      badge: 'bg-red-100',
      badgeText: 'text-red-700',
      label: t.health.statusDown,
      ring: 'ring-1 ring-red-200',
    },
    unmonitored: {
      dot: 'bg-slate-400',
      badge: 'bg-slate-100',
      badgeText: 'text-slate-700',
      label: t.health.statusUnmonitored,
    },
  };

  const services = data?.services ?? [];
  const overall = data?.overall ?? 'unmonitored';
  const recentErrors = data?.recentErrors ?? [];
  const stats = data?.stats;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="bg-gray-100 rounded-xl p-4 mb-3 animate-pulse h-[68px]" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-24 mb-2.5" />
              <div className="space-y-1.5">
                <div className="h-3 bg-gray-100 rounded w-full" />
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-5/6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full flex flex-col overflow-y-auto p-5">
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <ErrorState onRetry={() => refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-5">
      <HealthStatusBanner
        overall={overall}
        services={services}
        dataUpdatedAt={dataUpdatedAt}
        onRefresh={() => refetch()}
      />

      {/* Quick Platform Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 shrink-0">
          <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-[#1F114C]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[18px] font-bold text-[#1F114C]">{stats.userCount}</p>
              <p className="text-[10px] text-[#8B8B8B]">{t.health.totalUsers}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-blue-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15" />
              </svg>
            </div>
            <div>
              <p className="text-[18px] font-bold text-[#1F114C]">{stats.orgCount}</p>
              <p className="text-[10px] text-[#8B8B8B]">Organizaciones</p>
            </div>
          </div>
          <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-green-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
              </svg>
            </div>
            <div>
              <p className="text-[18px] font-bold text-green-600">{stats.loginsToday}</p>
              <p className="text-[10px] text-[#8B8B8B]">{t.health.loginsToday}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-violet-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
            </div>
            <div>
              <p className="text-[18px] font-bold text-[#1F114C]">{stats.auditLogsToday}</p>
              <p className="text-[10px] text-[#8B8B8B]">{t.health.eventsToday}</p>
            </div>
          </div>
        </div>
      )}

      {/* Service Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 shrink-0">
        {services.map((service) => {
          const config = statusConfig[service.status as ServiceStatus] || statusConfig.unmonitored;
          return (
            <div
              key={service.name}
              className={`bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${config.ring || ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${config.dot}`} />
                  <span className="text-[13px] font-semibold text-[#1F114C]">{service.name}</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[9px] font-semibold ${config.badge} ${config.badgeText}`}
                >
                  {config.label}
                </span>
              </div>
              <div className="space-y-2">
                {service.metrics?.map((metric, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-[11px] text-[#8B8B8B]">{metric.label}</span>
                    <span
                      className={`text-[12px] font-medium ${'color' in metric && metric.color ? METRIC_COLORS[metric.color] || 'text-[#1F114C]' : 'text-[#1F114C]'}`}
                    >
                      {metric.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Row: Chart + Errors — fills remaining space */}
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-[260px]">
        {/* API Response Time Chart */}
        <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <p className="text-[13px] font-semibold text-[#1F114C]">{t.health.apiResponseTime}</p>
          </div>
          {/* Honest unavailable state — no latency telemetry source is queried
              yet (no metrics store / OTel pipeline). Replaces a hardcoded fake
              polyline that posed as live p50/p95 data (rule #4). Wire to real
              metrics when a telemetry backend exists. */}
          <div className="flex-1 min-h-[120px] flex flex-col items-center justify-center text-center">
            <svg
              className="w-8 h-8 text-[#D4CFE5] mb-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 13.5h3.86a2.25 2.25 0 002.012-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.218a2.25 2.25 0 012.013 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z"
              />
            </svg>
            <p className="text-[12px] text-[#8B8B8B]">{t.health.latencyUnavailable}</p>
            <p className="text-[10px] text-[#ABABAB] mt-1">{t.health.latencyUnavailableHint}</p>
          </div>
        </div>

        {/* Error Log */}
        <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <p className="text-[13px] font-semibold text-[#1F114C]">{t.health.recentErrors}</p>
            <a href="/platform/audit" className="text-[11px] text-[#1F114C] font-medium hover:underline">
              {t.health.viewAll}
            </a>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2.5">
            {recentErrors.length > 0 ? (
              recentErrors.map((error) => {
                return (
                  <div
                    key={error.id}
                    className="flex items-start gap-3 p-2.5 rounded-lg border bg-[#FAFAFA] border-[#F0F0F0]"
                  >
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold mt-0.5 shrink-0 bg-slate-100 text-slate-700">
                      {t.health.recorded}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-medium text-[#1F114C]">{error.service}</span>
                        <span className="text-[10px] text-[#8B8B8B]">{formatRelativeTime(error.time)}</span>
                      </div>
                      <p className="text-[11px] text-[#585858] truncate">{error.message}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2">
                    <svg
                      className="w-5 h-5 text-slate-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 9v4m0 4h.01M4.93 4.93a10 10 0 1 1 14.14 14.14A10 10 0 0 1 4.93 4.93z" />
                    </svg>
                  </div>
                  <p className="text-[12px] text-[#8B8B8B]">{t.health.noRecentErrors}</p>
                  <p className="text-[10px] text-[#ABABAB] mt-0.5">{t.health.auditFeedLimited}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
