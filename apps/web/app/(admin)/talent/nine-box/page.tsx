'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, CandidateAvatar, EmptyState, Skeleton } from '../../../../components';
import { toast } from '../../../../lib/toast';
import { NineBoxGrid } from './nine-box-grid';

const PERIOD = new Date().getFullYear().toString();

const QUADRANT_LABELS: Record<string, string> = {
  star: 'Estrella', high_potential: 'Alto Potencial', enigma: 'Enigma',
  solid_performer: 'Prof. Solido', consistent_performer: 'Prof. Solido',
  core_player: 'Jugador Clave', inconsistent: 'Inconsistente',
  workhouse: 'Caballo de Trabajo', underperformer: 'Bajo Rendimiento', risk: 'Riesgo',
};

const QUADRANT_COLOR: Record<string, string> = {
  star: 'text-emerald-700 bg-emerald-50', high_potential: 'text-teal-700 bg-teal-50',
  enigma: 'text-amber-700 bg-amber-50', solid_performer: 'text-blue-700 bg-blue-50',
  consistent_performer: 'text-blue-700 bg-blue-50', core_player: 'text-slate-700 bg-slate-50',
  inconsistent: 'text-orange-700 bg-orange-50', workhouse: 'text-gray-700 bg-gray-50',
  underperformer: 'text-red-700 bg-red-50', risk: 'text-red-800 bg-red-100',
};

const BENCH_STATUS: Record<string, { label: string; cls: string }> = {
  covered: { label: 'Cubierto', cls: 'text-emerald-600 font-semibold' },
  risk: { label: 'Riesgo', cls: 'text-amber-600 font-semibold' },
  critical: { label: 'Critico', cls: 'text-red-600 font-semibold' },
};

const AUTO_PLANS = [
  { color: '#A7F3D0', name: 'Estrella', desc: 'Plan sucesion + Mentorias ejecutivas + Proyectos estrategicos' },
  { color: '#D1FAE5', name: 'Alto Potencial', desc: 'Asignacion proyectos retadores + Coach externo' },
  { color: '#DBEAFE', name: 'Alto Desempeno', desc: 'Desarrollo liderazgo + Rotacion interfuncional' },
  { color: '#F3F4F6', name: 'Prof. Solido', desc: 'Capacitacion tecnica + Reconocimiento' },
  { color: '#FFF3CD', name: 'Enigma', desc: 'Coaching intensivo + Reubicacion evaluada' },
  { color: '#FEE2E2', name: 'Riesgo', desc: 'PIP 90 dias + Seguimiento semanal + Decision Go/No-Go' },
];

export default function NineBoxPage() {
  const { t } = useI18n();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const gridQ = trpc.ninebox.getGrid.useQuery({ period: PERIOD });
  const kpisQ = trpc.ninebox.getDashboardKpis.useQuery({ period: PERIOD });
  const benchQ = trpc.ninebox.getBenchStrength.useQuery({ period: PERIOD });
  const successionQ = trpc.succession.listCriticalRoles.useQuery({});
  const detailQ = trpc.ninebox.getEmployeeDetail.useQuery(
    { userId: selectedUserId!, period: PERIOD },
    { enabled: !!selectedUserId },
  );

  const grid = gridQ.data?.grid ?? {};
  const total = gridQ.data?.totalEvaluations ?? 0;
  const dist = kpisQ.data?.distribution ?? {};

  const allPeople = useMemo(() => Object.values(grid).flat(), [grid]);

  const highPotentialCount = (dist['star'] ?? 0) + (dist['high_potential'] ?? 0) + (dist['enigma'] ?? 0);
  const atRiskCount = (dist['risk'] ?? 0) + (dist['underperformer'] ?? 0);
  const avgConfidence = allPeople.length > 0
    ? Math.round(allPeople.reduce((s, e) => s + (e.confidence ?? 0), 0) / allPeople.length * 100)
    : 0;

  // Auto-select first person when grid loads
  if (!selectedUserId && allPeople.length > 0) {
    setSelectedUserId(allPeople[0].user.id);
  }

  const isLoading = gridQ.isLoading || kpisQ.isLoading;

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden p-5">
        <div className="grid grid-cols-4 gap-3 mb-4">
          {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-[420px] rounded-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <EmptyState
          icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /></svg>}
          message={t.nineBox.noEvaluations}
          description={t.nineBox.noEvaluationsDesc}
        />
      </div>
    );
  }

  const detail = detailQ.data?.evaluation;
  const history = detailQ.data?.history ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">Talent</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">Nine Box Predictivo</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => toast('Exportar: proximamente', { type: 'info' })} className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px] hover:bg-[#F6F6F6] transition">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Exportar
          </button>
          <button onClick={() => toast('Iniciar Calibracion: proximamente', { type: 'info' })} className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c40b13] transition">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Iniciar Calibracion
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {/* KPI Row */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <KpiCard label="Total Evaluados" value={total} subtitle={`Ciclo ${PERIOD}`} iconBg="bg-[#1F114C]/10" icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>} valueColor="text-[#1F114C]" />
          <KpiCard label={t.nineBox.kpiHighPotential} value={highPotentialCount} subtitle={total > 0 ? `${Math.round((highPotentialCount / total) * 100)}% del total` : ''} iconBg="bg-emerald-50" icon={<svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>} valueColor="text-emerald-600" />
          <KpiCard label="En Riesgo" value={atRiskCount} subtitle="Plan urgente activo" iconBg="bg-red-50" icon={<svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /><path d="M12 15.75h.007v.008H12v-.008z" /></svg>} valueColor="text-[#DD0C15]" highlight />
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide block mb-3">Confianza Promedio</span>
            <div className="text-2xl font-bold text-[#1F114C]">{avgConfidence}%</div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
              <div className="bg-[#1F114C] h-1.5 rounded-full transition-all" style={{ width: `${avgConfidence}%` }} />
            </div>
          </div>
        </div>

        {/* Main two columns */}
        <div className="flex gap-4 mb-4">
          {/* Left: Nine Box Grid */}
          <div className="w-[58%]">
            <NineBoxGrid grid={grid} allPeople={allPeople} selectedUserId={selectedUserId} onSelectUser={setSelectedUserId} />
          </div>

          {/* Right column */}
          <div className="w-[42%] flex flex-col gap-4">
            {/* Selected Employee Detail */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
              <p className="text-[11px] font-semibold text-[#1F114C] mb-3">Detalle del Empleado Seleccionado</p>
              {detailQ.isLoading ? (
                <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : detail ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <CandidateAvatar firstName={detail.user.firstName} lastName={detail.user.lastName} avatar={detail.user.avatar} size="md" />
                    <div>
                      <p className="text-[13px] font-semibold text-[#333]">{detail.user.firstName} {detail.user.lastName}</p>
                      <p className="text-[11px] text-[#8B8B8B]">{detail.user.jobTitle ?? ''}</p>
                    </div>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${QUADRANT_COLOR[detail.quadrant] ?? 'text-gray-700 bg-gray-50'}`}>
                      {QUADRANT_LABELS[detail.quadrant] ?? detail.quadrant}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-[#F6F6F6] rounded-lg p-2.5">
                      <p className="text-[10px] text-[#8B8B8B] mb-0.5">{t.nineBox.potential}</p>
                      <p className="text-[20px] font-bold text-[#1F114C]">{Math.round(detail.potentialScore * 20)}<span className="text-[11px] font-normal text-[#8B8B8B]">/100</span></p>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${detail.potentialScore * 20}%` }} /></div>
                    </div>
                    <div className="bg-[#F6F6F6] rounded-lg p-2.5">
                      <p className="text-[10px] text-[#8B8B8B] mb-0.5">{t.nineBox.performance}</p>
                      <p className="text-[20px] font-bold text-[#1F114C]">{Math.round(detail.performanceScore * 20)}<span className="text-[11px] font-normal text-[#8B8B8B]">/100</span></p>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${detail.performanceScore * 20}%` }} /></div>
                    </div>
                  </div>
                  <div className="bg-[#F6F6F6] rounded-lg p-2.5 mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-[#8B8B8B]">Nivel de Confianza</p>
                      <p className="text-[12px] font-bold text-[#1F114C]">{Math.round(detail.confidence * 100)}%</p>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full" style={{ width: `${detail.confidence * 100}%`, background: 'linear-gradient(90deg,#10B981,#059669)' }} />
                    </div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <p className="text-[10px] font-semibold text-[#1F114C] mb-1.5">Historial de Movimiento</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {history.map((h, i) => (
                          <div key={h.period} className="flex items-center gap-2">
                            {i > 0 && <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>}
                            <div className={`px-2 py-1 rounded text-[9px] font-medium ${i === history.length - 1 ? 'ring-1 ring-emerald-400 bg-emerald-100 text-emerald-800 font-bold' : QUADRANT_COLOR[h.quadrant] ?? 'bg-gray-50 text-gray-700'}`}>
                              {QUADRANT_LABELS[h.quadrant] ?? h.quadrant}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[9px] text-[#8B8B8B] mt-1">{history.map((h) => h.period).join(' → ')}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-[#8B8B8B]">Selecciona un empleado del grid</p>
              )}
            </div>

            {/* Bench Strength by Critical Role */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
              <p className="text-[11px] font-semibold text-[#1F114C] mb-2">Bench Strength por Rol Critico</p>
              {successionQ.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                      <th className="text-left pb-1.5 font-medium">Rol</th>
                      <th className="text-center pb-1.5 font-medium">Listos</th>
                      <th className="text-center pb-1.5 font-medium">En Desarrollo</th>
                      <th className="text-center pb-1.5 font-medium">Brecha</th>
                    </tr>
                  </thead>
                  <tbody className="text-[#333]">
                    {(successionQ.data ?? []).map((role, i) => {
                      const ready = role.successors?.filter((s: { readiness: string }) => s.readiness === 'ready_now').length ?? 0;
                      const developing = role.successors?.filter((s: { readiness: string }) => s.readiness !== 'ready_now').length ?? 0;
                      const gap = ready === 0 && developing === 0 ? 'critical' : ready === 0 ? 'risk' : 'covered';
                      const gapStyle = BENCH_STATUS[gap] ?? BENCH_STATUS.covered;
                      return (
                        <tr key={role.id} className={`border-b border-[#F6F6F6] ${i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                          <td className="py-1.5">{role.title}</td>
                          <td className="text-center">
                            <span className={`${ready > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'} font-semibold px-1.5 py-0.5 rounded`}>{ready}</span>
                          </td>
                          <td className="text-center">
                            <span className="bg-amber-50 text-amber-700 font-semibold px-1.5 py-0.5 rounded">{developing}</span>
                          </td>
                          <td className="text-center"><span className={gapStyle.cls}>{gapStyle.label}</span></td>
                        </tr>
                      );
                    })}
                    {(successionQ.data ?? []).length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-center text-[#8B8B8B]">Sin roles criticos definidos</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Calibration Committee */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-[#1F114C]">Calibracion de Comite</p>
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                {kpisQ.data?.activeCalibrations ?? 0} Pendiente{(kpisQ.data?.activeCalibrations ?? 0) !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] mb-2">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[#585858]">{kpisQ.data?.calibrationSessions ?? 0} sesiones totales</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-[#585858]">{kpisQ.data?.activeCalibrations ?? 0} activas</span>
              </div>
            </div>
            <p className="text-[10px] text-[#8B8B8B]">Periodo: {PERIOD}</p>
          </div>

          {/* Auto-Plan by Quadrant */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
            <p className="text-[11px] font-semibold text-[#1F114C] mb-2">Plan Automatico por Cuadrante</p>
            <div className="space-y-1.5">
              {AUTO_PLANS.map((plan) => (
                <div key={plan.name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: plan.color }} />
                  <span className="text-[10px] font-semibold text-[#333] w-28 shrink-0">{plan.name}</span>
                  <span className="text-[10px] text-[#585858]">{plan.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
