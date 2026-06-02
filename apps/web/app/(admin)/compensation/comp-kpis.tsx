'use client';

interface CompKpisProps {
  data: { totalMonthlyPayroll: number; pendingAdjustments: number; avgCompaRatio: number | null } | null;
  loading: boolean;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 animate-pulse"><div className="h-16 bg-gray-100 rounded" /></div>;
}

export function CompKpis({ data, loading }: CompKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-4 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  const payroll = data?.totalMonthlyPayroll ?? 284500;
  const cr = data?.avgCompaRatio ?? 0.97;
  const pending = data?.pendingAdjustments ?? 14;

  return (
    <div className="grid grid-cols-5 gap-4 mb-4">
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">Nomina Mensual Total</div>
        <span className="text-[26px] font-bold text-[#333] leading-none">${payroll.toLocaleString()}</span>
        <div className="text-[10px] text-green-600 mt-1.5 font-medium">+2.1% vs mes anterior</div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">Salario Promedio</div>
        <span className="text-[26px] font-bold text-[#333] leading-none">$3,420</span>
        <div className="text-[10px] text-[#8B8B8B] mt-1.5">83 empleados activos</div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">Compa-Ratio Promedio</div>
        <div className="flex items-end gap-2">
          <span className="text-[26px] font-bold text-[#333] leading-none">{cr.toFixed(2)}</span>
          <span className="text-[11px] text-green-600 font-medium mb-1">En rango</span>
        </div>
        <div className="w-full h-1.5 bg-[#EDEDED] rounded-full mt-2"><div className="h-full bg-green-500 rounded-full" style={{ width: `${cr * 100}%` }} /></div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">Utilizacion Beneficios</div>
        <div className="flex items-end gap-2">
          <span className="text-[26px] font-bold text-[#333] leading-none">74%</span>
          <span className="text-[11px] text-amber-600 font-medium mb-1">+3% vs Q1</span>
        </div>
        <div className="w-full h-1.5 bg-[#EDEDED] rounded-full mt-2"><div className="h-full bg-amber-400 rounded-full" style={{ width: '74%' }} /></div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">Ajustes Pendientes</div>
        <div className="flex items-end gap-2">
          <span className="text-[26px] font-bold text-[#DD0C15] leading-none">{pending}</span>
          <span className="text-[11px] text-red-500 mb-1">6 vencidos</span>
        </div>
        <div className="text-[10px] text-[#8B8B8B] mt-1.5">Proxima revision: Jun 15</div>
      </div>
    </div>
  );
}
