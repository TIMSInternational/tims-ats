'use client';

import { useState } from 'react';
import { trpc } from '../../../lib/trpc';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUptime(value: number): string {
  return `${value.toFixed(2)}%`;
}

function timeAgo(timestamp: string | Date): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

function getActivityColor(type: string): string {
  switch (type) {
    case 'org_created': return 'bg-green-400';
    case 'plan_upgrade': return 'bg-blue-400';
    case 'payment_failed': return 'bg-[#DD0C15]';
    case 'user_registered': return 'bg-purple-400';
    case 'trial_expiring': return 'bg-amber-400';
    case 'users_added': return 'bg-blue-400';
    case 'onboarding_complete': return 'bg-green-400';
    default: return 'bg-gray-400';
  }
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-3 w-24 bg-gray-200 rounded" />
        <div className="w-8 h-8 rounded-lg bg-gray-100" />
      </div>
      <div className="h-7 w-16 bg-gray-200 rounded mt-2" />
      <div className="h-3 w-20 bg-gray-100 rounded mt-2" />
    </div>
  );
}

function SkeletonTimeline() {
  return (
    <div className="space-y-3.5 animate-pulse">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-gray-200 mt-1.5" />
          <div className="flex-1">
            <div className="h-4 w-3/4 bg-gray-200 rounded" />
            <div className="h-3 w-1/2 bg-gray-100 rounded mt-1.5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const kpis = trpc.platform.getDashboardKpis.useQuery();
  const activity = trpc.platform.getRecentActivity.useQuery();

  return (
    <main className="flex-1 overflow-y-auto p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {kpis.isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : kpis.data ? (
          <>
            {/* Total Organizaciones */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Total Organizaciones</span>
                <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.totalOrgs}</div>
              <div className="text-xs text-green-500 mt-1 font-medium">Actualizado</div>
            </div>
            {/* Total Usuarios */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Total Usuarios</span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.totalUsers.toLocaleString()}</div>
              <div className="text-xs text-green-500 mt-1 font-medium">Actualizado</div>
            </div>
            {/* MRR */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">MRR</span>
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{formatCurrency(kpis.data.mrr)}</div>
              <div className="text-xs text-green-500 mt-1 font-medium">Ingresos recurrentes</div>
            </div>
            {/* Trials Activos */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Trials Activos</span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.activeTrials}</div>
              <div className="text-xs text-amber-500 mt-1 font-medium">En periodo de prueba</div>
            </div>
            {/* Uptime */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Uptime</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{formatUptime(kpis.data.uptime)}</div>
              <div className="text-xs text-emerald-500 mt-1 font-medium">Sistema operativo</div>
            </div>
          </>
        ) : (
          <div className="col-span-5 text-center py-8 text-sm text-[#8B8B8B]">
            Error al cargar KPIs. Intente de nuevo.
          </div>
        )}
      </div>

      {/* Two Column Layout */}
      <div className="flex gap-5">
        {/* LEFT 60% — Actividad Reciente */}
        <div className="w-[60%] space-y-5">
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#333]">Actividad Reciente</h3>
              <button className="text-xs text-[#1F114C] font-medium hover:underline">Ver todo</button>
            </div>
            {activity.isLoading ? (
              <SkeletonTimeline />
            ) : activity.data && activity.data.length > 0 ? (
              <div className="space-y-3.5">
                {activity.data.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full ${getActivityColor(item.type)} mt-1.5 flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#333]">
                        <span className="font-medium">{item.title}</span>
                      </p>
                      <p className="text-xs text-[#8B8B8B] mt-0.5">
                        {timeAgo(item.timestamp)}
                        {item.meta ? ` — ${item.meta}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <svg className="w-10 h-10 text-[#EDEDED] mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-[#8B8B8B]">No hay actividad reciente</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT 40% — Alertas + Acciones Rapidas */}
        <div className="w-[40%] space-y-5">
          {/* Alertas del Sistema */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#333]">Alertas del Sistema</h3>
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#DD0C15] text-white text-[10px] font-bold">—</span>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-blue-50">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-blue-700 bg-blue-100 uppercase flex-shrink-0 mt-0.5">Info</span>
                <div>
                  <p className="text-xs text-[#333] font-medium">Modulo de alertas en configuracion</p>
                  <p className="text-[10px] text-[#8B8B8B] mt-0.5">Las alertas del sistema se configuraran proximamente</p>
                </div>
              </div>
            </div>
          </div>

          {/* Acciones Rapidas */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#333] mb-4">Acciones Rapidas</h3>
            <div className="grid grid-cols-2 gap-3">
              <a href="/platform/organizations" className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#333] hover:bg-[#F6F6F6] transition">
                <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                Crear Organizacion
              </a>
              <a href="/platform/users" className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#333] hover:bg-[#F6F6F6] transition">
                <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6M23 11h-6" /></svg>
                Invitar Usuario
              </a>
              <a href="/platform/audit" className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#333] hover:bg-[#F6F6F6] transition">
                <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></svg>
                Ver Auditoria
              </a>
              <a href="/platform/health" className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#333] hover:bg-[#F6F6F6] transition">
                <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                Salud del Sistema
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
