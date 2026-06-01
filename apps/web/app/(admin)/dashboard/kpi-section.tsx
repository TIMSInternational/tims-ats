'use client';

import { formatCurrency } from './dashboard-utils';

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

interface KpiData {
  totalOrgs: number;
  totalUsers: number;
  mrr: number;
  activeTrials: number;
  uptime: number;
}

export function KpiSection({ data, isLoading }: { data?: KpiData; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-4 mb-6 flex-shrink-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
            <Skeleton className="h-3 w-28 mb-3" />
            <Skeleton className="h-7 w-16 mb-2" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-5 gap-4 mb-6 flex-shrink-0">
      {/* Total Organizaciones */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Total Organizaciones</span>
          <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg>
          </div>
        </div>
        <div className="text-2xl font-bold text-[#333]">{data.totalOrgs}</div>
        <div className="text-xs text-green-500 mt-1 font-medium">+3 este mes</div>
      </div>
      {/* Total Usuarios */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Total Usuarios</span>
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
          </div>
        </div>
        <div className="text-2xl font-bold text-[#333]">{data.totalUsers.toLocaleString()}</div>
        <div className="text-xs text-green-500 mt-1 font-medium">+124 este mes</div>
      </div>
      {/* MRR */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">MRR</span>
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg>
          </div>
        </div>
        <div className="text-2xl font-bold text-[#333]">{formatCurrency(data.mrr)}</div>
        <div className="text-xs text-green-500 mt-1 font-medium">+12% vs mes anterior</div>
      </div>
      {/* Trials Activos */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Trials Activos</span>
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          </div>
        </div>
        <div className="text-2xl font-bold text-[#333]">{data.activeTrials}</div>
        <div className="text-xs text-amber-500 mt-1 font-medium">3 vencen esta semana</div>
      </div>
      {/* Uptime */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Uptime</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
          </div>
        </div>
        <div className="text-2xl font-bold text-[#333]">{data.uptime.toFixed(2)}%</div>
        <div className="text-xs text-emerald-500 mt-1 font-medium">Ultimo incidente: hace 12d</div>
      </div>
    </div>
  );
}
