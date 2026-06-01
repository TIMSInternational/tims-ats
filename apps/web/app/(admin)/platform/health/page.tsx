'use client';

import { trpc } from '../../../../lib/trpc';

const STATUS_CONFIG: Record<string, { dot: string; badge: string; badgeText: string; label: string; ring?: string }> = {
  operational: { dot: 'bg-green-500', badge: 'bg-green-100', badgeText: 'text-green-700', label: 'Operativo' },
  degraded: { dot: 'bg-amber-500', badge: 'bg-amber-100', badgeText: 'text-amber-700', label: 'Degradado', ring: 'ring-1 ring-amber-200' },
  down: { dot: 'bg-red-500', badge: 'bg-red-100', badgeText: 'text-red-700', label: 'Caido', ring: 'ring-1 ring-red-200' },
};

const METRIC_COLORS: Record<string, string> = {
  green: 'text-green-600',
  red: 'text-[#DD0C15]',
  amber: 'text-amber-600',
};

const PROGRESS_COLORS: Record<string, string> = {
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
};

function formatTimeAgo(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
  return `Hace ${Math.floor(hours / 24)} dia${Math.floor(hours / 24) > 1 ? 's' : ''}`;
}

export default function PlatformHealthPage() {
  const { data, isLoading, refetch, dataUpdatedAt } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const services = data?.services ?? [];
  const overall = data?.overall ?? 'operational';
  const recentErrors = data?.recentErrors ?? [];

  const operationalCount = services.filter((s) => s.status === 'operational').length;
  const totalServices = services.length;
  const degradedCount = services.filter((s) => (s.status as string) === 'degraded').length;
  const downCount = services.filter((s) => s.status === 'down').length;

  const timeSinceUpdate = dataUpdatedAt
    ? `hace ${Math.max(1, Math.floor((Date.now() - dataUpdatedAt) / 1000))} seg`
    : '';

  const isAllOperational = overall === 'operational';

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="bg-gray-100 rounded-xl p-4 mb-3 animate-pulse h-[68px]" />
        <div className="grid grid-cols-4 gap-3 mb-3">
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

  return (
    <div className="h-full overflow-y-auto p-5">
      {/* OVERALL STATUS BANNER */}
      <div className={`${isAllOperational ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'} border rounded-xl px-4 py-3 mb-3 flex items-center gap-3`}>
        <div className={`w-9 h-9 rounded-full ${isAllOperational ? 'bg-green-500' : 'bg-amber-500'} flex items-center justify-center shrink-0`}>
          {isAllOperational ? (
            <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
          ) : (
            <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
          )}
        </div>
        <div className="flex-1">
          <p className={`text-[13px] font-semibold ${isAllOperational ? 'text-green-800' : 'text-amber-800'}`}>
            {isAllOperational ? 'Todos los sistemas operativos' : 'Algunos servicios presentan problemas'}
          </p>
          <p className={`text-[11px] ${isAllOperational ? 'text-green-600' : 'text-amber-600'}`}>
            {operationalCount} de {totalServices} servicios funcionando al 100%.
            {degradedCount > 0 && ` ${degradedCount} servicio${degradedCount > 1 ? 's' : ''} degradado${degradedCount > 1 ? 's' : ''}.`}
            {downCount > 0 && ` ${downCount} servicio${downCount > 1 ? 's' : ''} caido${downCount > 1 ? 's' : ''}.`}
          </p>
        </div>
        <div className="text-right mr-3">
          <p className={`text-[10px] ${isAllOperational ? 'text-green-600' : 'text-amber-600'}`}>Uptime global (30 dias)</p>
          <p className={`text-[17px] font-bold ${isAllOperational ? 'text-green-700' : 'text-amber-700'}`}>99.97%</p>
        </div>
        <span className="text-[10px] text-[#8B8B8B]">{timeSinceUpdate ? `Actualizado: ${timeSinceUpdate}` : ''}</span>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-7 rounded-lg text-[11px] hover:bg-[#FAFAFA] bg-white shrink-0"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
          Refrescar
        </button>
      </div>

      {/* SERVICE STATUS GRID */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        {services.map((service) => {
          const config = STATUS_CONFIG[service.status] || STATUS_CONFIG.operational;
          return (
            <div
              key={service.name}
              className={`bg-white rounded-xl p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${config.ring || ''}`}
            >
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                  <span className="text-[12px] font-semibold text-[#1F114C]">{service.name}</span>
                </div>
                <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-semibold ${config.badge} ${config.badgeText}`}>
                  {config.label}
                </span>
              </div>
              <div className="space-y-1.5">
                {service.metrics?.map((metric, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-[10px] text-[#8B8B8B]">{metric.label}</span>
                    <span className={`text-[11px] font-medium ${'color' in metric && metric.color ? METRIC_COLORS[metric.color] : 'text-[#1F114C]'}`}>
                      {metric.value}
                    </span>
                  </div>
                ))}
                {service.progressBar && (
                  <div className="w-full h-1.5 bg-[#EDEDED] rounded-full">
                    <div
                      className={`h-1.5 rounded-full ${PROGRESS_COLORS[service.progressBar.color] || 'bg-blue-500'}`}
                      style={{ width: `${service.progressBar.percent}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* BOTTOM ROW: Chart + Errors */}
      <div className="grid grid-cols-2 gap-3 h-[220px] flex-shrink-0">
        {/* API Response Time Chart */}
        <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-semibold text-[#1F114C]">Tiempo de Respuesta API (24h)</p>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[9px] text-[#8B8B8B]"><span className="w-1.5 h-1.5 rounded-full bg-[#1F114C]" />p50</span>
              <span className="flex items-center gap-1 text-[9px] text-[#8B8B8B]"><span className="w-1.5 h-1.5 rounded-full bg-[#DD0C15]" />p95</span>
            </div>
          </div>
          <div className="relative h-[150px]">
            {/* Y axis */}
            <div className="absolute left-0 top-0 bottom-4 flex flex-col justify-between text-[8px] text-[#8B8B8B] w-7">
              <span>100ms</span><span>75ms</span><span>50ms</span><span>25ms</span><span>0ms</span>
            </div>
            {/* Chart */}
            <div className="ml-8 h-full relative pb-4">
              <div className="absolute inset-0 bottom-4 flex flex-col justify-between">
                {[0, 1, 2, 3].map(i => <div key={i} className="border-t border-dashed border-[#EDEDED]" />)}
                <div className="border-t border-[#EDEDED]" />
              </div>
              <svg className="absolute inset-0 w-full" style={{ height: 'calc(100% - 16px)' }} preserveAspectRatio="none" viewBox="0 0 100 100">
                <polyline fill="none" stroke="#1F114C" strokeWidth="1.5" points="0,70 5,68 10,72 15,65 20,60 25,62 30,58 35,55 40,60 45,63 50,58 55,55 60,52 65,58 70,62 75,55 80,50 85,52 90,55 95,58 100,55" />
                <polyline fill="none" stroke="#DD0C15" strokeWidth="1.5" strokeDasharray="3,2" points="0,50 5,48 10,52 15,45 20,38 25,42 30,35 35,32 40,40 45,42 50,38 55,35 60,30 65,38 70,42 75,35 80,28 85,30 90,35 95,38 100,35" />
              </svg>
              <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[8px] text-[#8B8B8B]">
                <span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>Ahora</span>
              </div>
            </div>
          </div>
        </div>

        {/* Error Log */}
        <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <p className="text-[12px] font-semibold text-[#1F114C]">Ultimos Errores</p>
            <a href="/platform/audit" className="text-[10px] text-[#1F114C] font-medium hover:underline">Ver todos</a>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {recentErrors.length > 0 ? (
              recentErrors.map((error) => {
                const isInvestigating = (error.status as string) === 'investigating';
                return (
                  <div
                    key={error.id}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${isInvestigating ? 'bg-amber-50/50 border-amber-100' : 'bg-[#FAFAFA] border-[#F0F0F0]'}`}
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold mt-0.5 shrink-0 ${isInvestigating ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {isInvestigating ? 'Investigando' : 'Resuelto'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-medium text-[#1F114C]">{error.service}</span>
                        <span className="text-[9px] text-[#8B8B8B]">{formatTimeAgo(error.time)}</span>
                      </div>
                      <p className="text-[10px] text-[#585858] truncate">{error.message}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                  </div>
                  <p className="text-[11px] text-[#8B8B8B]">Sin errores recientes</p>
                  <p className="text-[9px] text-[#ABABAB] mt-0.5">Todos los sistemas funcionando correctamente</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
