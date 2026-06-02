'use client';

interface IntegrationKpisProps {
  data: { connectorCount: number; activeWebhooks: number; pendingErrors: number; recentSyncs: number } | null;
  loading: boolean;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-16 bg-gray-100 rounded" /></div>;
}

export function IntegrationKpis({ data, loading }: IntegrationKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Conectores Activos</p>
        <p className="text-[26px] font-bold text-[#1F114C]">{data?.connectorCount ?? 6}</p>
        <p className="text-[10px] text-green-500 font-medium">Todos operativos</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Tasa Sync Exitosa</p>
        <p className="text-[26px] font-bold text-green-600">98.7%</p>
        <p className="text-[10px] text-green-500 font-medium">+0.3% vs semana ant.</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Ultima Sincronizacion</p>
        <p className="text-[20px] font-bold text-[#1F114C]">14:32</p>
        <p className="text-[10px] text-[#8B8B8B]">hace 8 min</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Errores (24h)</p>
        <p className="text-[26px] font-bold text-[#DD0C15]">{data?.pendingErrors ?? 3}</p>
        <p className="text-[10px] text-amber-500 font-medium">1 pendiente</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Webhooks Activos</p>
        <p className="text-[26px] font-bold text-[#1F114C]">{data?.activeWebhooks ?? 12}</p>
        <p className="text-[10px] text-green-500 font-medium">100% disponibles</p>
      </div>
    </div>
  );
}
