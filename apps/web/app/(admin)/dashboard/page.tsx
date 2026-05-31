'use client';

import { trpc } from '../../../lib/trpc';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);
}

function timeAgo(timestamp: string | Date): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  return `Hace ${Math.floor(hours / 24)}d`;
}

function getActivityColor(type: string): string {
  switch (type) {
    case 'org_created': return 'bg-green-500';
    case 'platform_owner': return 'bg-purple-500';
    case 'user_created': return 'bg-blue-500';
    case 'payment_failed': return 'bg-[#DD0C15]';
    default: return 'bg-gray-400';
  }
}

const PLAN_COLORS: Record<string, string> = {
  trial: '#8B8B8B',
  starter: '#3B82F6',
  professional: '#8B5CF6',
  enterprise: '#1F114C',
};

const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

export default function DashboardPage() {
  const kpis = trpc.platform.getDashboardKpis.useQuery();
  const activity = trpc.platform.getRecentActivity.useQuery();
  const planDist = trpc.platform.getPlanDistribution.useQuery();
  const userGrowth = trpc.platform.getUserGrowth.useQuery();

  const maxGrowth = Math.max(...(userGrowth.data?.map(m => m.count) || [1]));

  return (
    <div className="p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {kpis.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
              <Skeleton className="h-3 w-28 mb-3" />
              <Skeleton className="h-7 w-16 mb-2" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))
        ) : kpis.data ? (
          <>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#8B8B8B] font-medium uppercase tracking-wider">Total Organizaciones</span>
                <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
                </div>
              </div>
              <div className="text-[28px] font-bold text-[#1F114C]">{kpis.data.totalOrgs}</div>
              <div className="text-[10px] text-green-600 font-medium mt-0.5">En la plataforma</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#8B8B8B] font-medium uppercase tracking-wider">Total Usuarios</span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
                </div>
              </div>
              <div className="text-[28px] font-bold text-[#1F114C]">{kpis.data.totalUsers.toLocaleString()}</div>
              <div className="text-[10px] text-green-600 font-medium mt-0.5">Usuarios activos</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#8B8B8B] font-medium uppercase tracking-wider">MRR</span>
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
              </div>
              <div className="text-[28px] font-bold text-[#1F114C]">{formatCurrency(kpis.data.mrr)}</div>
              <div className="text-[10px] text-green-600 font-medium mt-0.5">Ingresos recurrentes</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#8B8B8B] font-medium uppercase tracking-wider">Trials Activos</span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                </div>
              </div>
              <div className="text-[28px] font-bold text-[#1F114C]">{kpis.data.activeTrials}</div>
              <div className="text-[10px] text-amber-600 font-medium mt-0.5">En periodo de prueba</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#8B8B8B] font-medium uppercase tracking-wider">Uptime</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                </div>
              </div>
              <div className="text-[28px] font-bold text-[#1F114C]">{kpis.data.uptime.toFixed(2)}%</div>
              <div className="text-[10px] text-emerald-600 font-medium mt-0.5">Sistema operativo</div>
            </div>
          </>
        ) : null}
      </div>

      {/* Two Column Layout */}
      <div className="flex gap-5 mb-6">
        {/* LEFT 60% */}
        <div className="w-[60%] space-y-5">
          {/* Actividad Reciente */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-[#1F114C]">Actividad Reciente</h3>
              <a href="/platform/audit" className="text-[11px] text-[#1F114C] font-medium hover:underline">Ver todo</a>
            </div>
            {activity.isLoading ? (
              <div className="space-y-4 animate-pulse">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : activity.data && activity.data.length > 0 ? (
              <div className="space-y-3">
                {activity.data.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getActivityColor(item.type)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-[#333] font-medium">{item.title}</p>
                      <p className="text-[10px] text-[#8B8B8B] mt-0.5">
                        {timeAgo(item.timestamp)}{item.meta ? ` — ${item.meta}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[#8B8B8B] text-center py-8">No hay actividad reciente</p>
            )}
          </div>

          {/* Crecimiento de Usuarios */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">Crecimiento de Usuarios</h3>
            {userGrowth.isLoading ? (
              <div className="h-[180px] animate-pulse"><Skeleton className="h-full w-full" /></div>
            ) : userGrowth.data ? (
              <div className="flex items-end gap-3 h-[180px]">
                {userGrowth.data.map((m, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-[11px] font-bold text-[#1F114C]">{m.count}</span>
                    <div className="w-full bg-[#F6F6F6] rounded-t-lg relative" style={{ height: 140 }}>
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-[#1F114C] rounded-t-lg transition-all"
                        style={{ height: `${maxGrowth > 0 ? (m.count / maxGrowth) * 100 : 0}%`, minHeight: m.count > 0 ? 8 : 0 }}
                      />
                    </div>
                    <span className="text-[10px] text-[#8B8B8B] capitalize">{m.month}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT 40% */}
        <div className="w-[40%] space-y-5">
          {/* Organizaciones por Plan */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">Organizaciones por Plan</h3>
            {planDist.isLoading ? (
              <div className="space-y-3 animate-pulse">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
            ) : planDist.data ? (
              <>
                {/* Simple donut using CSS */}
                <div className="flex items-center gap-5 mb-4">
                  <div className="relative w-[100px] h-[100px]">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      {(() => {
                        let offset = 0;
                        return planDist.data.map((p) => {
                          const dash = p.percentage;
                          const el = (
                            <circle
                              key={p.plan}
                              cx="18" cy="18" r="15.915"
                              fill="none"
                              stroke={PLAN_COLORS[p.plan] || '#ccc'}
                              strokeWidth="3.5"
                              strokeDasharray={`${dash} ${100 - dash}`}
                              strokeDashoffset={-offset}
                            />
                          );
                          offset += dash;
                          return el;
                        });
                      })()}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[16px] font-bold text-[#1F114C]">{planDist.data.reduce((s, p) => s + p.count, 0)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {planDist.data.map((p) => (
                      <div key={p.plan} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLAN_COLORS[p.plan] }} />
                        <span className="text-[11px] text-[#333]">{PLAN_LABELS[p.plan] || p.plan}</span>
                        <span className="text-[11px] text-[#8B8B8B] ml-auto">{p.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* Alertas del Sistema */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-[#1F114C]">Alertas del Sistema</h3>
              <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
              </span>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-green-50">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-green-700 bg-green-100 uppercase shrink-0 mt-0.5">OK</span>
                <div>
                  <p className="text-[11px] text-[#333] font-medium">Todos los sistemas operativos</p>
                  <p className="text-[10px] text-[#8B8B8B] mt-0.5">Sin alertas criticas activas</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-blue-50">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-blue-700 bg-blue-100 uppercase shrink-0 mt-0.5">Info</span>
                <div>
                  <p className="text-[11px] text-[#333] font-medium">Modulo de alertas avanzadas en desarrollo</p>
                  <p className="text-[10px] text-[#8B8B8B] mt-0.5">Se habilitara con Trigger.dev workers</p>
                </div>
              </div>
            </div>
          </div>

          {/* Acciones Rapidas */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">Acciones Rapidas</h3>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { href: '/platform/organizations', label: 'Crear Organizacion', icon: <path d="M12 5v14M5 12h14" /> },
                { href: '/platform/users', label: 'Invitar Usuario', icon: <><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6M23 11h-6" /></> },
                { href: '/platform/audit', label: 'Ver Auditoria', icon: <><path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></> },
                { href: '/platform/health', label: 'Salud del Sistema', icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2" /> },
              ].map((a) => (
                <a key={a.href} href={a.href} className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#EDEDED] text-[11px] font-medium text-[#333] hover:bg-[#FAFAFA] transition">
                  <svg className="w-4 h-4 text-[#1F114C] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">{a.icon}</svg>
                  {a.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
