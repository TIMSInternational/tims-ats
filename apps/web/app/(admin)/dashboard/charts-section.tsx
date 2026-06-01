'use client';

import {
  formatCurrency,
  timeAgo,
  mapNotifType,
  getAlertStyles,
  PLAN_COLORS,
  PLAN_DOT_CLASSES,
  PLAN_LABELS,
  BAR_OPACITIES,
} from './dashboard-utils';

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

/* ─── User Growth Bar Chart ─── */

interface GrowthMonth { month: string; count: number }

export function UserGrowthChart({ data, isLoading }: { data?: GrowthMonth[]; isLoading: boolean }) {
  const maxGrowth = Math.max(...(data?.map(m => m.count) || [1]));

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#333]">Crecimiento de Usuarios</h3>
        <span className="text-xs text-[#8B8B8B]">Ultimos 6 meses</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-[140px] w-full" />
      ) : data ? (
        <div className="flex items-end gap-3 h-[140px] px-2">
          {data.map((m, i) => {
            const heightPct = maxGrowth > 0 ? Math.max((m.count / maxGrowth) * 95, m.count > 0 ? 15 : 3) : 3;
            const isLast = i === data.length - 1;
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
  );
}

/* ─── Plan Distribution Donut ─── */

interface PlanItem { plan: string; count: number }

export function PlanDistribution({ data, isLoading }: { data?: PlanItem[]; isLoading: boolean }) {
  const circumference = 2 * Math.PI * 14;
  const donutSegments = data
    ? (() => {
        let offset = 0;
        const total = data.reduce((s, p) => s + p.count, 0) || 1;
        return data.map((p) => {
          const fraction = p.count / total;
          const dash = fraction * circumference;
          const segment = { plan: p.plan, dash, offset, count: p.count };
          offset += dash;
          return segment;
        });
      })()
    : [];

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-[#333] mb-4">Organizaciones por Plan</h3>
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : data ? (
        <div className="flex items-center gap-6">
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
                {data.reduce((s, p) => s + p.count, 0)}
              </span>
              <span className="text-[10px] text-[#8B8B8B]">Total</span>
            </div>
          </div>
          <div className="space-y-2.5 flex-1">
            {data.map((p) => (
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
  );
}

/* ─── System Alerts ─── */

interface NotifItem {
  id: string;
  type: string;
  title: string;
  createdAt: string | Date;
}

export function SystemAlerts({ notifications, isLoading }: { notifications?: NotifItem[]; isLoading: boolean }) {
  const items = notifications ?? [];

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#333]">Alertas del Sistema</h3>
        {items.length > 0 ? (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#DD0C15] text-white text-[10px] font-bold">
            {items.length}
          </span>
        ) : (
          <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
          </span>
        )}
      </div>
      <div className="space-y-3">
        {isLoading ? (
          <div className="space-y-3 animate-pulse">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-lg" />)}</div>
        ) : items.length > 0 ? (
          items.map((notif) => {
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
  );
}

/* ─── MRR Trend Chart ─── */

interface MrrMonth { month: string; mrr: number }

export function MrrTrendChart({ data, isLoading }: { data?: MrrMonth[]; isLoading: boolean }) {
  return (
    <div className="flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#333]">Tendencia de MRR</h3>
        <span className="text-xs text-[#8B8B8B]">Ultimos 6 meses</span>
      </div>
      {isLoading ? (
        <div className="h-[140px] animate-pulse"><div className="h-full w-full bg-gray-100 rounded" /></div>
      ) : data ? (
        <div className="relative">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ bottom: 24, top: 18 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="border-t border-dashed border-[#F0F0F0]" />
            ))}
          </div>
          <div className="flex items-end gap-4 px-2 relative" style={{ height: 130 }}>
            {(() => {
              const maxH = 110;
              const max = Math.max(...data.map(m => m.mrr), 1);
              return data.map((m, i) => {
                const barH = m.mrr > 0 ? Math.max(Math.round((m.mrr / max) * maxH), 16) : 2;
                const isLast = i === data.length - 1;
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
  );
}

/* ─── Platform Metrics ─── */

export function PlatformMetrics({ mrr, totalOrgs }: { mrr?: number; totalOrgs?: number }) {
  return (
    <div className="w-[340px] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-[#333] mb-4">Metricas de Plataforma</h3>
      <div className="space-y-3.5">
        {[
          { label: 'ARPU', value: mrr != null && totalOrgs ? formatCurrency(Math.round(mrr / (totalOrgs || 1))) : '\u2014', sub: 'Ingreso promedio por org' },
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
  );
}

/* ─── Quick Actions ─── */

export function QuickActions() {
  return (
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
  );
}
