'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatRelativeTime } from '../../../../lib/format-utils';
import { ErrorState } from '../../../../components';

export function SystemInfo() {
  const { t } = useI18n();
  const { data: health, isLoading: healthLoading, isError: healthError, refetch: refetchHealth } = trpc.platform.getSystemHealth.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: events, isLoading: eventsLoading, isError: eventsError, refetch: refetchEvents } = trpc.platform.getRecentPlatformEvents.useQuery({ limit: 10 }, { refetchInterval: 30_000 });

  const statusColor = (status: string) => {
    if (status === 'operational') return 'bg-green-500';
    if (status === 'degraded') return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-[#333] mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        {t.support.systemInfo}
      </h3>

      {healthLoading ? (
        <div className="space-y-2 mb-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-[#F6F6F6] rounded-lg animate-pulse" />)}</div>
      ) : healthError ? (
        <ErrorState onRetry={() => refetchHealth()} />
      ) : health ? (
        <>
          <div className="flex items-center gap-2 mb-4">
            <span className={`w-2.5 h-2.5 rounded-full ${statusColor(health.overall)}`} />
            <span className="text-sm font-medium text-[#585858]">{health.overall === 'operational' ? t.support.allOperational : t.support.someDegraded}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-[#333]">{health.stats.userCount}</div>
              <div className="text-[10px] text-[#8B8B8B] uppercase">{t.support.users}</div>
            </div>
            <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-[#333]">{health.stats.orgCount}</div>
              <div className="text-[10px] text-[#8B8B8B] uppercase">{t.support.orgs}</div>
            </div>
            <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-[#333]">{health.stats.loginsToday}</div>
              <div className="text-[10px] text-[#8B8B8B] uppercase">{t.support.loginsToday}</div>
            </div>
            <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-[#333]">{health.services.find(s => s.name === 'Base de Datos')?.metrics.find(m => m.label === 'Query time')?.value || '--'}</div>
              <div className="text-[10px] text-[#8B8B8B] uppercase">{t.support.dbLatency}</div>
            </div>
          </div>
          <div className="text-[11px] text-[#8B8B8B] uppercase tracking-wide mb-2">{t.support.services}</div>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {health.services.map((svc) => (
              <div key={svc.name} className="flex items-center gap-2 border border-[#EDEDED] rounded-lg px-3 py-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor(svc.status)}`} />
                <span className="text-xs text-[#585858] font-medium truncate">{svc.name}</span>
                <span className="text-[10px] text-[#8B8B8B] ml-auto">{svc.status === 'operational' ? 'OK' : svc.status}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="text-[11px] text-[#8B8B8B] uppercase tracking-wide mb-2">{t.support.recentEvents}</div>
      {eventsLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-[#F6F6F6] rounded-lg animate-pulse" />)}</div>
      ) : eventsError ? (
        <ErrorState onRetry={() => refetchEvents()} />
      ) : events && events.length > 0 ? (
        <div className="overflow-x-auto"><table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-[#EDEDED]">
              <th className="text-left text-[10px] text-[#8B8B8B] uppercase tracking-wider font-medium pb-2">Hora</th>
              <th className="text-left text-[10px] text-[#8B8B8B] uppercase tracking-wider font-medium pb-2">Actor</th>
              <th className="text-left text-[10px] text-[#8B8B8B] uppercase tracking-wider font-medium pb-2">Accion</th>
              <th className="text-left text-[10px] text-[#8B8B8B] uppercase tracking-wider font-medium pb-2">Entidad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F6F6F6]">
            {events.map((evt) => (
              <tr key={evt.id}>
                <td className="py-2 text-[11px] text-[#8B8B8B] whitespace-nowrap">{formatRelativeTime(evt.createdAt)}</td>
                <td className="py-2 text-[11px] text-[#585858] truncate max-w-[120px]">{evt.actor ? `${evt.actor.firstName || ''} ${evt.actor.lastName || ''}`.trim() || evt.actor.email : t.support.system}</td>
                <td className="py-2 text-[11px] text-[#585858]">{evt.action}</td>
                <td className="py-2 text-[11px] text-[#8B8B8B]">{evt.entity || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-[#8B8B8B]">{t.support.noEvents}</p>
          <p className="text-xs text-[#ABABAB] mt-1">{t.support.noEventsDesc}</p>
        </div>
      )}
    </div>
  );
}
