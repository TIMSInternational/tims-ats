'use client';

import { trpc } from '../../../../lib/trpc';

export default function AnalyticsPage() {
  const { data, isLoading } = trpc.platform.getAnalytics.useQuery();

  if (isLoading) {
    return (
      <main className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
              <div className="h-7 bg-gray-200 rounded w-16 mb-2" />
              <div className="h-2 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
        <div className="flex gap-5">
          <div className="w-[55%] space-y-5">
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[300px] animate-pulse" />
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[280px] animate-pulse" />
          </div>
          <div className="w-[45%] space-y-5">
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[200px] animate-pulse" />
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[280px] animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <p className="text-sm text-gray-500">No hay datos de analytics disponibles</p>
        </div>
      </main>
    );
  }

  const totalSubs = data.subscriptionsByPlan
    ? Object.values(data.subscriptionsByPlan).reduce((s: number, v) => s + (v as number), 0)
    : 0;

  const planColors: Record<string, string> = {
    starter: '#9B8DD4',
    professional: '#5B42A5',
    enterprise: '#2D1B69',
    custom: '#1F114C',
  };

  const planLabels: Record<string, string> = {
    starter: 'Starter',
    professional: 'Professional',
    enterprise: 'Enterprise',
    custom: 'Custom',
  };

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Organizaciones</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-800">{data.totalOrgs ?? 0}</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Total activas</div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Usuarios Totales</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-800">{data.totalUsers?.toLocaleString() ?? 0}</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">{data.activeUsersLast30d?.toLocaleString() ?? 0} activos (30d)</div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Tasa de Churn</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-800">{data.churnRate != null ? `${data.churnRate}%` : '--'}</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Mensual</div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">ARPU</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-800">{data.arpu != null ? `$${data.arpu}` : '--'}</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">USD / org / mes</div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">DAU / MAU</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-800">{data.dauMauRatio != null ? `${data.dauMauRatio}%` : '--'}</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Engagement ratio</div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-5">
        {/* LEFT 55% */}
        <div className="w-[55%] space-y-5">
          {/* Distribucion de Planes */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Distribucion de Planes</h3>
            {data.subscriptionsByPlan && totalSubs > 0 ? (
              <div className="space-y-3">
                {Object.entries(data.subscriptionsByPlan).map(([plan, count]) => {
                  const pct = Math.round(((count as number) / totalSubs) * 100);
                  return (
                    <div key={plan} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-[100px] text-right">{planLabels[plan] ?? plan}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
                          style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: planColors[plan] ?? '#7B6BBF' }}
                        >
                          <span className="text-[10px] text-white font-medium">{pct}%</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{count as number}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-6">Sin datos de suscripciones</p>
            )}
            <div className="mt-3 text-[11px] text-gray-400">Total suscripciones: {totalSubs}</div>
          </div>

          {/* Adopcion de Modulos (placeholder) */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Adopcion de Modulos</h3>
            <div className="space-y-3">
              {[
                { name: 'Pipeline', pct: 95, color: '#1F114C' },
                { name: 'Candidatos', pct: 90, color: '#1F114C' },
                { name: 'Entrevistas', pct: 78, color: '#2D1B69' },
                { name: 'Onboarding', pct: 65, color: '#3D2980' },
                { name: 'Performance', pct: 45, color: '#5B42A5' },
                { name: 'Nine Box', pct: 23, color: '#7B6BBF' },
                { name: 'DEI', pct: 18, color: '#9B8DD4' },
                { name: 'Compensacion', pct: 15, color: '#B5AAE0' },
              ].map((mod) => (
                <div key={mod.name} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-[100px] text-right">{mod.name}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full flex items-center pr-2 transition-all"
                      style={{
                        width: `${mod.pct}%`,
                        backgroundColor: mod.color,
                        justifyContent: mod.pct > 30 ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <span className={`text-[10px] text-white font-medium ${mod.pct <= 30 ? 'ml-1' : ''}`}>{mod.pct}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-gray-400">% de organizaciones que usan cada modulo</div>
          </div>
        </div>

        {/* RIGHT 45% */}
        <div className="w-[45%] space-y-5">
          {/* Metricas de Engagement */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Metricas de Engagement</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-800">{data.totalUsers?.toLocaleString() ?? 0}</div>
                <div className="text-[11px] text-gray-400 uppercase mt-1">Usuarios Totales</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-800">{data.activeUsersLast30d?.toLocaleString() ?? 0}</div>
                <div className="text-[11px] text-gray-400 uppercase mt-1">Activos (30d)</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-800">{data.dauMauRatio != null ? `${data.dauMauRatio}%` : '--'}</div>
                <div className="text-[11px] text-gray-400 uppercase mt-1">DAU/MAU Ratio</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-800">{data.churnRate != null ? `${data.churnRate}%` : '--'}</div>
                <div className="text-[11px] text-gray-400 uppercase mt-1">Churn Rate</div>
              </div>
            </div>
          </div>

          {/* Distribucion Geografica (placeholder) */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Distribucion Geografica</h3>
            <div className="space-y-2.5">
              {[
                { flag: '\u{1F1E8}\u{1F1F4}', name: 'Colombia', pct: 48, count: 890, color: '#1F114C' },
                { flag: '\u{1F1F2}\u{1F1FD}', name: 'Mexico', pct: 18, count: 340, color: '#2D1B69' },
                { flag: '\u{1F1F5}\u{1F1EA}', name: 'Peru', pct: 11, count: 210, color: '#3D2980' },
                { flag: '\u{1F1E8}\u{1F1F1}', name: 'Chile', pct: 10, count: 180, color: '#5B42A5' },
                { flag: '\u{1F1E6}\u{1F1F7}', name: 'Argentina', pct: 6, count: 120, color: '#7B6BBF' },
                { flag: '\u{1F30D}', name: 'Otros', pct: 6, count: 107, color: '#D1D5DB' },
              ].map((c) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-lg">{c.flag}</span>
                  <span className="text-sm text-gray-700 flex-1">{c.name}</span>
                  <div className="w-[140px] bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
                  </div>
                  <span className="text-sm font-semibold text-gray-800 w-10 text-right">{c.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-400">
              <span>Total usuarios</span>
              <span className="font-semibold text-gray-700">{data.totalUsers?.toLocaleString() ?? 0}</span>
            </div>
          </div>

          {/* Revenue */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Revenue</h3>
            <div className="flex gap-6">
              <div className="flex-1">
                <div className="text-[11px] text-gray-400 uppercase">MRR Estimado</div>
                <div className="text-xl font-bold text-gray-800">
                  ${data.arpu != null && data.totalOrgs != null
                    ? (data.arpu * data.totalOrgs).toLocaleString()
                    : '--'}
                </div>
                <div className="text-xs text-gray-400 mt-1">ARPU x Organizaciones</div>
              </div>
              <div className="w-px bg-gray-100" />
              <div className="flex-1">
                <div className="text-[11px] text-gray-400 uppercase">ARPU</div>
                <div className="text-xl font-bold text-gray-800">${data.arpu ?? '--'}</div>
                <div className="text-xs text-gray-400 mt-1">USD / org / mes</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
