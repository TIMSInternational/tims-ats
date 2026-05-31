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

function getActivityDotColor(type: string): string {
  switch (type) {
    case 'org_created': return 'bg-green-400';
    case 'user_created': return 'bg-purple-400';
    case 'platform_owner': return 'bg-blue-400';
    case 'payment_failed': return 'bg-[#DD0C15]';
    case 'plan_upgrade': return 'bg-blue-400';
    case 'trial_expiring': return 'bg-amber-400';
    case 'bulk_users': return 'bg-blue-400';
    case 'onboarding_complete': return 'bg-green-400';
    default: return 'bg-gray-400';
  }
}

function getActivityIconColor(type: string): string {
  switch (type) {
    case 'org_created': return 'text-green-400';
    case 'user_created': return 'text-purple-400';
    case 'platform_owner': return 'text-blue-400';
    case 'payment_failed': return 'text-[#DD0C15]';
    case 'plan_upgrade': return 'text-blue-400';
    case 'trial_expiring': return 'text-amber-400';
    case 'bulk_users': return 'text-blue-400';
    case 'onboarding_complete': return 'text-green-400';
    default: return 'text-gray-400';
  }
}

function ActivityIcon({ type }: { type: string }) {
  const colorClass = getActivityIconColor(type);
  switch (type) {
    case 'org_created':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" />
        </svg>
      );
    case 'plan_upgrade':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case 'payment_failed':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" />
        </svg>
      );
    case 'user_created':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" />
        </svg>
      );
    case 'platform_owner':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" />
        </svg>
      );
    case 'trial_expiring':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
        </svg>
      );
    case 'bulk_users':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case 'onboarding_complete':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
        </svg>
      );
    default:
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
      );
  }
}

const PLAN_COLORS: Record<string, string> = {
  trial: '#F59E0B',
  starter: '#3B82F6',
  professional: '#8B5CF6',
  enterprise: '#10B981',
};

const PLAN_DOT_CLASSES: Record<string, string> = {
  trial: 'bg-amber-400',
  starter: 'bg-blue-500',
  professional: 'bg-violet-500',
  enterprise: 'bg-emerald-500',
};

const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

const BAR_OPACITIES = [
  'bg-[#1F114C]/15',
  'bg-[#1F114C]/20',
  'bg-[#1F114C]/25',
  'bg-[#1F114C]/35',
  'bg-[#1F114C]/50',
  'bg-[#1F114C]',
];

function mapNotifType(type: string): 'critical' | 'warning' | 'info' {
  if (type === 'critical') return 'critical';
  if (type === 'warning') return 'warning';
  return 'info';
}

function getAlertStyles(severity: 'critical' | 'warning' | 'info') {
  switch (severity) {
    case 'critical':
      return { bg: 'bg-red-50', badge: 'text-red-700 bg-red-100', label: 'Critico' };
    case 'warning':
      return { bg: 'bg-amber-50', badge: 'text-amber-700 bg-amber-100', label: 'Warning' };
    case 'info':
      return { bg: 'bg-blue-50', badge: 'text-blue-700 bg-blue-100', label: 'Info' };
  }
}

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

export default function DashboardPage() {
  const kpis = trpc.platform.getDashboardKpis.useQuery();
  const activity = trpc.platform.getRecentActivity.useQuery();
  const planDist = trpc.platform.getPlanDistribution.useQuery();
  const userGrowth = trpc.platform.getUserGrowth.useQuery();
  const alerts = trpc.notification.list.useQuery({ limit: 5 });
  const mrrTrend = trpc.platform.getMrrTrend.useQuery();

  const maxGrowth = Math.max(...(userGrowth.data?.map(m => m.count) || [1]));

  // Compute donut stroke values from real plan distribution data
  const circumference = 2 * Math.PI * 14; // ~87.96
  const donutSegments = planDist.data
    ? (() => {
        let offset = 0;
        const total = planDist.data.reduce((s, p) => s + p.count, 0) || 1;
        return planDist.data.map((p) => {
          const fraction = p.count / total;
          const dash = fraction * circumference;
          const segment = { plan: p.plan, dash, offset, count: p.count };
          offset += dash;
          return segment;
        });
      })()
    : [];

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
            {/* Total Organizaciones */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Total Organizaciones</span>
                <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.totalOrgs}</div>
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
              <div className="text-2xl font-bold text-[#333]">{kpis.data.totalUsers.toLocaleString()}</div>
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
              <div className="text-2xl font-bold text-[#333]">{formatCurrency(kpis.data.mrr)}</div>
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
              <div className="text-2xl font-bold text-[#333]">{kpis.data.activeTrials}</div>
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
              <div className="text-2xl font-bold text-[#333]">{kpis.data.uptime.toFixed(2)}%</div>
              <div className="text-xs text-emerald-500 mt-1 font-medium">Ultimo incidente: hace 12d</div>
            </div>
          </>
        ) : null}
      </div>

      {/* Two Column Layout */}
      <div className="flex gap-5 mb-6">
        {/* LEFT 60% */}
        <div className="w-[60%] flex flex-col gap-5">
          {/* Actividad Reciente */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#333]">Actividad Reciente</h3>
              <button className="text-xs text-[#1F114C] font-medium hover:underline">Ver todo</button>
            </div>
            {activity.isLoading ? (
              <div className="space-y-3.5 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : activity.data && activity.data.length > 0 ? (
              <div className="space-y-3.5">
                {activity.data.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${getActivityDotColor(item.type)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#333]">
                        <span className="font-medium">{item.title.replace(/^(Nueva organizacion: |Nuevo usuario: )/, '')}</span>
                        {item.type === 'org_created' && ' se registro como nueva organizacion'}
                        {item.type === 'user_created' && ' se registro como nuevo usuario'}
                        {item.type === 'platform_owner' && ' se registro como administrador'}
                        {item.type === 'plan_upgrade' && ' actualizo su plan'}
                        {item.type === 'payment_failed' && ' — pago fallido de suscripcion'}
                        {item.type === 'trial_expiring' && ' — trial vence pronto'}
                        {item.type === 'bulk_users' && ' agrego usuarios nuevos'}
                        {item.type === 'onboarding_complete' && ' completo configuracion inicial'}
                      </p>
                      <p className="text-xs text-[#8B8B8B] mt-0.5">
                        {timeAgo(item.timestamp)}{item.meta ? ` — ${item.meta}` : ''}
                      </p>
                    </div>
                    <ActivityIcon type={item.type} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#8B8B8B] text-center py-8">No hay actividad reciente</p>
            )}
          </div>

          {/* Crecimiento de Usuarios */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#333]">Crecimiento de Usuarios</h3>
              <span className="text-xs text-[#8B8B8B]">Ultimos 6 meses</span>
            </div>
            {userGrowth.isLoading ? (
              <Skeleton className="h-[140px] w-full" />
            ) : userGrowth.data ? (
              <div className="flex items-end gap-3 h-[140px] px-2">
                {userGrowth.data.map((m, i) => {
                  const heightPct = maxGrowth > 0 ? Math.max((m.count / maxGrowth) * 95, m.count > 0 ? 15 : 3) : 3;
                  const isLast = i === userGrowth.data!.length - 1;
                  const opacityClass = BAR_OPACITIES[Math.min(i, BAR_OPACITIES.length - 1)];
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                      <span className={`text-[10px] font-medium ${isLast ? 'text-[#1F114C] font-bold' : 'text-[#8B8B8B]'}`}>
                        {m.count.toLocaleString()}
                      </span>
                      <div
                        className={`w-full ${opacityClass} rounded-t-md`}
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className={`text-[10px] ${isLast ? 'text-[#333] font-medium' : 'text-[#8B8B8B]'}`}>
                        {m.month.charAt(0).toUpperCase() + m.month.slice(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT 40% */}
        <div className="w-[40%] flex flex-col gap-5">
          {/* Organizaciones por Plan */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#333] mb-4">Organizaciones por Plan</h3>
            {planDist.isLoading ? (
              <div className="space-y-3 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : planDist.data ? (
              <div className="flex items-center gap-6">
                {/* Donut Chart */}
                <div className="relative w-[120px] h-[120px] flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    {donutSegments.map((seg) => (
                      <circle
                        key={seg.plan}
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke={PLAN_COLORS[seg.plan] || '#ccc'}
                        strokeWidth="4"
                        strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
                        strokeDashoffset={-seg.offset}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold text-[#333]">
                      {planDist.data.reduce((s, p) => s + p.count, 0)}
                    </span>
                    <span className="text-[10px] text-[#8B8B8B]">Total</span>
                  </div>
                </div>
                {/* Legend */}
                <div className="space-y-2.5 flex-1">
                  {planDist.data.map((p) => (
                    <div key={p.plan} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${PLAN_DOT_CLASSES[p.plan] || 'bg-gray-400'}`} />
                        <span className="text-xs text-[#585858]">{PLAN_LABELS[p.plan] || p.plan}</span>
                      </div>
                      <span className="text-xs font-semibold text-[#333]">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Alertas del Sistema */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#333]">Alertas del Sistema</h3>
              {(alerts.data?.notifications?.length ?? 0) > 0 ? (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#DD0C15] text-white text-[10px] font-bold">
                  {alerts.data!.notifications.length}
                </span>
              ) : (
                <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
                </span>
              )}
            </div>
            <div className="space-y-3">
              {alerts.isLoading ? (
                <div className="space-y-3 animate-pulse">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-lg" />)}</div>
              ) : alerts.data?.notifications && alerts.data.notifications.length > 0 ? (
                alerts.data.notifications.map((notif) => {
                  const severity = mapNotifType(notif.type);
                  const styles = getAlertStyles(severity);
                  return (
                    <div key={notif.id} className={`flex items-start gap-3 p-2.5 rounded-lg ${styles.bg}`}>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 mt-0.5 ${styles.badge}`}>
                        {styles.label}
                      </span>
                      <div>
                        <p className="text-xs text-[#333] font-medium">{notif.title}</p>
                        <p className="text-[10px] text-[#8B8B8B] mt-0.5">{timeAgo(notif.createdAt)}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-green-50">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-green-700 bg-green-100 uppercase flex-shrink-0 mt-0.5">OK</span>
                  <div>
                    <p className="text-xs text-[#333] font-medium">Sin alertas activas</p>
                    <p className="text-[10px] text-[#8B8B8B] mt-0.5">Todos los sistemas operativos</p>
                  </div>
                </div>
              )}
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

      {/* Bottom: Revenue Trend + Platform Stats */}
      <div className="flex gap-5">
        {/* MRR Trend */}
        <div className="flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#333]">Tendencia de MRR</h3>
            <span className="text-xs text-[#8B8B8B]">Ultimos 6 meses</span>
          </div>
          {mrrTrend.isLoading ? (
            <div className="h-[140px] animate-pulse"><div className="h-full w-full bg-gray-100 rounded" /></div>
          ) : mrrTrend.data ? (
            <div className="relative">
              {/* Grid lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ bottom: 24, top: 18 }}>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="border-t border-dashed border-[#F0F0F0]" />
                ))}
              </div>
              <div className="flex items-end gap-4 px-2 relative" style={{ height: 130 }}>
                {(() => {
                  const maxH = 110;
                  const max = Math.max(...mrrTrend.data.map(m => m.mrr), 1);
                  return mrrTrend.data.map((m, i) => {
                    const barH = m.mrr > 0 ? Math.max(Math.round((m.mrr / max) * maxH), 16) : 2;
                    const isLast = i === mrrTrend.data!.length - 1;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                        <span className={`text-[10px] font-medium ${isLast && m.mrr > 0 ? 'text-green-600 font-bold' : 'text-[#8B8B8B]'}`}>
                          {m.mrr === 0 ? '$0' : `$${m.mrr >= 1000 ? (m.mrr / 1000).toFixed(1) + 'k' : m.mrr}`}
                        </span>
                        <div
                          className="w-full rounded-t-md"
                          style={{
                            height: barH,
                            backgroundColor: m.mrr === 0 ? '#EDEDED' : isLast ? '#22c55e' : `rgba(34, 197, 94, ${0.15 + (i / 5) * 0.85})`,
                          }}
                        />
                        <span className={`text-[10px] ${isLast ? 'text-[#333] font-medium' : 'text-[#8B8B8B]'}`}>
                          {m.month.charAt(0).toUpperCase() + m.month.slice(1)}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : null}
        </div>

        {/* Platform Stats */}
        <div className="w-[340px] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-sm font-semibold text-[#333] mb-4">Metricas de Plataforma</h3>
          <div className="space-y-3.5">
            {[
              { label: 'ARPU', value: kpis.data ? formatCurrency(Math.round(kpis.data.mrr / (kpis.data.totalOrgs || 1))) : '—', sub: 'Ingreso promedio por org' },
              { label: 'Churn Rate', value: '2.1%', sub: 'Tasa de cancelacion mensual' },
              { label: 'DAU/MAU', value: '34%', sub: 'Ratio de engagement' },
              { label: 'AI Calls (mes)', value: '4,230', sub: 'Haiku 62% / Sonnet 38%' },
              { label: 'Storage', value: '12.4 GB', sub: 'De 50 GB disponibles' },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] text-[#333] font-medium">{stat.label}</p>
                  <p className="text-[10px] text-[#8B8B8B]">{stat.sub}</p>
                </div>
                <span className="text-[14px] font-bold text-[#1F114C]">{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
