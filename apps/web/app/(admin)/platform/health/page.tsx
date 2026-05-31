'use client';

import { trpc } from '../../../../lib/trpc';

const STATUS_CONFIG: Record<string, { dot: string; badge: string; badgeText: string; label: string; ring?: string }> = {
  operational: { dot: 'bg-green-500', badge: 'bg-green-100', badgeText: 'text-green-700', label: 'Operativo' },
  degraded: { dot: 'bg-amber-500', badge: 'bg-amber-100', badgeText: 'text-amber-700', label: 'Degradado', ring: 'ring-1 ring-amber-200' },
  down: { dot: 'bg-red-500', badge: 'bg-red-100', badgeText: 'text-red-700', label: 'Caido', ring: 'ring-1 ring-red-200' },
};

export default function PlatformHealthPage() {
  const { data, isLoading, refetch, dataUpdatedAt } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const services = data?.services ?? [];
  const overall = data?.overall ?? 'operational';

  const operationalCount = services.filter(s => s.status === 'operational').length;
  const totalServices = services.length;
  const degradedCount = services.filter(s => s.status === 'degraded').length;
  const downCount = services.filter(s => (s.status as string) === 'down').length;

  const timeSinceUpdate = dataUpdatedAt
    ? `hace ${Math.max(1, Math.floor((Date.now() - dataUpdatedAt) / 1000))} seg`
    : '';

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-gray-100 rounded-xl p-4 mb-4 animate-pulse h-[72px]" />
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-100 rounded w-full" />
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-5/6" />
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-[13px] text-[#8B8B8B]">Verificando estado de los servicios...</p>
      </div>
    );
  }

  const isAllOperational = overall === 'operational';

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* OVERALL STATUS BANNER */}
      <div className={`${isAllOperational ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'} border rounded-xl p-4 mb-4 flex items-center gap-3`}>
        <div className={`w-10 h-10 rounded-full ${isAllOperational ? 'bg-green-500' : 'bg-amber-500'} flex items-center justify-center shrink-0`}>
          {isAllOperational ? (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          )}
        </div>
        <div>
          <p className={`text-[14px] font-semibold ${isAllOperational ? 'text-green-800' : 'text-amber-800'}`}>
            {isAllOperational ? 'Todos los sistemas operativos' : 'Algunos servicios presentan problemas'}
          </p>
          <p className={`text-[12px] ${isAllOperational ? 'text-green-600' : 'text-amber-600'}`}>
            {operationalCount} de {totalServices} servicios funcionando al 100%.
            {degradedCount > 0 && ` ${degradedCount} servicio${degradedCount > 1 ? 's' : ''} degradado${degradedCount > 1 ? 's' : ''}.`}
            {downCount > 0 && ` ${downCount} servicio${downCount > 1 ? 's' : ''} caido${downCount > 1 ? 's' : ''}.`}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className={`text-[11px] ${isAllOperational ? 'text-green-600' : 'text-amber-600'}`}>Uptime global (30 dias)</p>
          <p className={`text-[18px] font-bold ${isAllOperational ? 'text-green-700' : 'text-amber-700'}`}>99.97%</p>
        </div>
      </div>

      {/* Refresh info */}
      <div className="flex items-center justify-end gap-3 mb-4">
        <span className="text-[11px] text-[#8B8B8B]">
          {timeSinceUpdate ? `Ultima actualizacion: ${timeSinceUpdate}` : ''}
        </span>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px] hover:bg-[#FAFAFA]"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Refrescar
        </button>
      </div>

      {/* SERVICE STATUS GRID */}
      <div className="grid grid-cols-4 gap-3">
        {services.map((service) => {
          const config = STATUS_CONFIG[service.status] || STATUS_CONFIG.operational;
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
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold ${config.badge} ${config.badgeText}`}>
                  {config.label}
                </span>
              </div>
              <div className="space-y-2">
                {service.latency && (
                  <div className="flex justify-between">
                    <span className="text-[11px] text-[#8B8B8B]">Latencia p95</span>
                    <span className="text-[12px] font-medium text-[#1F114C]">{service.latency}</span>
                  </div>
                )}
                {service.uptime && (
                  <div className="flex justify-between">
                    <span className="text-[11px] text-[#8B8B8B]">Uptime</span>
                    <span className="text-[12px] font-medium text-green-600">{service.uptime}</span>
                  </div>
                )}
                {service.detail && (
                  <div className="flex justify-between">
                    <span className="text-[11px] text-[#8B8B8B]">Detalle</span>
                    <span className="text-[12px] font-medium text-[#1F114C]">{service.detail}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {services.length === 0 && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-12 text-center mt-4">
          <svg className="w-10 h-10 mx-auto mb-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <p className="text-[13px] text-[#8B8B8B]">No hay datos de salud del sistema disponibles</p>
        </div>
      )}
    </div>
  );
}
