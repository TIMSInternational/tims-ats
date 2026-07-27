'use client';

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSuccessionCriticalRoles } from '../../../../lib/platform-api/succession';
import {
  useNineBoxGrid,
  useNineBoxDashboardKpis,
  useNineBoxListCalibrations,
  useNineBoxBenchStrength,
  useNineBoxEmployeeDetail,
  useNineBoxCreateCalibration,
  isNineboxForbiddenError,
  invalidateNineboxPlatformReads,
} from '../../../../lib/platform-api/ninebox';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, CandidateAvatar, EmptyState, ErrorState, Skeleton } from '../../../../components';
import { toast } from '../../../../lib/toast';
import { NineBoxGrid } from './nine-box-grid';
import { CalibrationModal } from './calibration-modal';

const PERIOD = new Date().getFullYear().toString();

const QUADRANT_LABELS: Record<string, string> = {
  star: 'Estrella',
  high_potential: 'Alto Potencial',
  enigma: 'Enigma',
  solid_performer: 'Prof. Solido',
  consistent_performer: 'Prof. Solido',
  core_player: 'Jugador Clave',
  inconsistent: 'Inconsistente',
  workhouse: 'Caballo de Trabajo',
  underperformer: 'Bajo Rendimiento',
  risk: 'Riesgo',
};

const QUADRANT_COLOR: Record<string, string> = {
  star: 'text-emerald-700 bg-emerald-50',
  high_potential: 'text-teal-700 bg-teal-50',
  enigma: 'text-amber-700 bg-amber-50',
  solid_performer: 'text-blue-700 bg-blue-50',
  consistent_performer: 'text-blue-700 bg-blue-50',
  core_player: 'text-slate-700 bg-slate-50',
  inconsistent: 'text-orange-700 bg-orange-50',
  workhouse: 'text-gray-700 bg-gray-50',
  underperformer: 'text-red-700 bg-red-50',
  risk: 'text-red-800 bg-red-100',
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

// ── Types inferred from tRPC ─────────────────────────────────────────────────
type CalibrationSessionSummary = {
  id: string;
  period: string;
  status: string;
  scheduledAt: Date | null;
  createdAt: Date;
  _count: { members: number };
};

type CommitteeT = {
  sessionsTitle: string;
  manage: string;
  noSessions: string;
  membersCount: string;
  statusDraft: string;
  statusActive: string;
  statusFinalized: string;
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'text-amber-700 bg-amber-50',
  active: 'text-emerald-700 bg-emerald-50',
  finalized: 'text-gray-600 bg-gray-100',
};

function CalibrationSessionsList({
  sessions,
  isLoading,
  isError,
  onManage,
  t,
}: {
  sessions: CalibrationSessionSummary[];
  isLoading: boolean;
  isError: boolean;
  onManage: (id: string) => void;
  t: CommitteeT;
}) {
  const statusLabel = (status: string, tc: CommitteeT) => {
    if (status === 'draft') return tc.statusDraft;
    if (status === 'active') return tc.statusActive;
    if (status === 'finalized') return tc.statusFinalized;
    return status;
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <p className="text-[11px] font-semibold text-[#1F114C] mb-2">{t.sessionsTitle}</p>
      {isLoading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : isError ? (
        <ErrorState />
      ) : sessions.length === 0 ? (
        <p className="text-[10px] text-[#8B8B8B] py-3 text-center">{t.noSessions}</p>
      ) : (
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#EDEDED]">
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[s.status] ?? 'text-gray-600 bg-gray-100'}`}
              >
                {statusLabel(s.status, t)}
              </span>
              <span className="text-[11px] text-[#333] font-medium flex-1">{s.period}</span>
              <span className="text-[10px] text-[#8B8B8B] shrink-0">
                {s._count.members} {t.membersCount}
              </span>
              <button
                onClick={() => onManage(s.id)}
                className="shrink-0 h-7 px-2.5 rounded-md text-[11px] text-[#1F114C] border border-[#EDEDED] hover:bg-[#F6F6F6] transition"
              >
                {t.manage}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NineBoxPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [calibrationSessionId, setCalibrationSessionId] = useState<string | null>(null);

  const gridQ = useNineBoxGrid(PERIOD);
  const kpisQ = useNineBoxDashboardKpis(PERIOD);

  // listCalibrations is org-governance (slice-7a): narrow-scope users (committee
  // leaders) can still reach this page via 'ninebox' read but get a FORBIDDEN
  // here. Treat that as "no calibration sessions visible" — the wrapper leaves
  // the 403 as a (retry-disabled) error on both the tRPC and C# paths, and
  // isNineboxForbiddenError normalizes it so the list falls back to an empty
  // state, never a crash.
  const sessionsQ = useNineBoxListCalibrations();
  const sessionsForbidden = isNineboxForbiddenError(sessionsQ.error);

  const startCalibration = useNineBoxCreateCalibration({
    onSuccess: (session) => {
      setCalibrationSessionId(session.id);
      sessionsQ.refetch();
      // Cutover parity: refresh the C# platform-api nine-box reads. No-op under tRPC.
      invalidateNineboxPlatformReads(queryClient);
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });
  const benchQ = useNineBoxBenchStrength(PERIOD);
  const successionQ = useSuccessionCriticalRoles({});
  const detailQ = useNineBoxEmployeeDetail(selectedUserId, PERIOD);

  const grid = gridQ.data?.grid ?? {};
  const total = gridQ.data?.totalEvaluations ?? 0;
  const dist = kpisQ.data?.distribution ?? {};

  const allPeople = useMemo(() => Object.values(grid).flat(), [grid]);

  const highPotentialCount = (dist['star'] ?? 0) + (dist['high_potential'] ?? 0) + (dist['enigma'] ?? 0);
  const atRiskCount = (dist['risk'] ?? 0) + (dist['underperformer'] ?? 0);
  const avgConfidence =
    allPeople.length > 0
      ? Math.round((allPeople.reduce((s, e) => s + (e.confidence ?? 0), 0) / allPeople.length) * 100)
      : 0;

  // Auto-select first person when grid loads
  if (!selectedUserId && allPeople.length > 0) {
    setSelectedUserId(allPeople[0].user.id);
  }

  const isLoading = gridQ.isLoading || kpisQ.isLoading;

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-[420px] rounded-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (gridQ.isError || kpisQ.isError) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <ErrorState
          onRetry={() => {
            gridQ.refetch();
            kpisQ.refetch();
          }}
        />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <EmptyState
          icon={
            <svg
              className="w-10 h-10 text-[#ccc]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="3" width="18" height="18" rx="1" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
            </svg>
          }
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
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.sidebar.talent}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.nineBox.predictiveTitle}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => toast(t.nineBox.exportComingSoon, { type: 'info' })}
            className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px] hover:bg-[#F6F6F6] transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t.common.export}
          </button>
          <button
            onClick={() => startCalibration.mutate({ period: PERIOD })}
            disabled={startCalibration.isPending}
            className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c40b13] transition disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t.committee.newSession}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiCard
            label="Total Evaluados"
            value={total}
            subtitle={`Ciclo ${PERIOD}`}
            iconBg="bg-[#1F114C]/10"
            icon={
              <svg
                className="w-4 h-4 text-[#1F114C]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            }
            valueColor="text-[#1F114C]"
          />
          <KpiCard
            label={t.nineBox.kpiHighPotential}
            value={highPotentialCount}
            subtitle={total > 0 ? `${Math.round((highPotentialCount / total) * 100)}% del total` : ''}
            iconBg="bg-emerald-50"
            icon={
              <svg
                className="w-4 h-4 text-emerald-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
            }
            valueColor="text-emerald-600"
          />
          <KpiCard
            label="En Riesgo"
            value={atRiskCount}
            subtitle="Plan urgente activo"
            iconBg="bg-red-50"
            icon={
              <svg
                className="w-4 h-4 text-[#DD0C15]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                <path d="M12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
            valueColor="text-[#DD0C15]"
            highlight
          />
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide block mb-3">
              {t.nineBox.avgConfidence}
            </span>
            <div className="text-xl md:text-2xl font-bold text-[#1F114C]">{avgConfidence}%</div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
              <div className="bg-[#1F114C] h-1.5 rounded-full transition-all" style={{ width: `${avgConfidence}%` }} />
            </div>
          </div>
        </div>

        {/* Main two columns */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          {/* Left: Nine Box Grid */}
          <div className="w-full md:w-[58%]">
            <NineBoxGrid
              grid={grid}
              allPeople={allPeople}
              selectedUserId={selectedUserId}
              onSelectUser={setSelectedUserId}
            />
          </div>

          {/* Right column */}
          <div className="w-full md:w-[42%] flex flex-col gap-4">
            {/* Selected Employee Detail */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
              <p className="text-[11px] font-semibold text-[#1F114C] mb-3">{t.nineBox.selectedEmployeeDetail}</p>
              {detailQ.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : detailQ.isError ? (
                <ErrorState />
              ) : detail ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <CandidateAvatar
                      firstName={detail.user.firstName}
                      lastName={detail.user.lastName}
                      avatar={detail.user.avatar}
                      size="md"
                    />
                    <div>
                      <p className="text-[13px] font-semibold text-[#333]">
                        {detail.user.firstName} {detail.user.lastName}
                      </p>
                      <p className="text-[11px] text-[#8B8B8B]">{detail.user.jobTitle ?? ''}</p>
                    </div>
                    <span
                      className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${QUADRANT_COLOR[detail.quadrant] ?? 'text-gray-700 bg-gray-50'}`}
                    >
                      {QUADRANT_LABELS[detail.quadrant] ?? detail.quadrant}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-[#F6F6F6] rounded-lg p-2.5">
                      <p className="text-[10px] text-[#8B8B8B] mb-0.5">{t.nineBox.potential}</p>
                      <p className="text-[20px] font-bold text-[#1F114C]">
                        {Math.round(detail.potentialScore * 20)}
                        <span className="text-[11px] font-normal text-[#8B8B8B]">/100</span>
                      </p>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                        <div
                          className="bg-emerald-500 h-1.5 rounded-full"
                          style={{ width: `${detail.potentialScore * 20}%` }}
                        />
                      </div>
                    </div>
                    <div className="bg-[#F6F6F6] rounded-lg p-2.5">
                      <p className="text-[10px] text-[#8B8B8B] mb-0.5">{t.nineBox.performance}</p>
                      <p className="text-[20px] font-bold text-[#1F114C]">
                        {Math.round(detail.performanceScore * 20)}
                        <span className="text-[11px] font-normal text-[#8B8B8B]">/100</span>
                      </p>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full"
                          style={{ width: `${detail.performanceScore * 20}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="bg-[#F6F6F6] rounded-lg p-2.5 mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-[#8B8B8B]">{t.nineBox.confidenceLevel}</p>
                      <p className="text-[12px] font-bold text-[#1F114C]">{Math.round(detail.confidence * 100)}%</p>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${detail.confidence * 100}%`,
                          background: 'linear-gradient(90deg,#10B981,#059669)',
                        }}
                      />
                    </div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <p className="text-[10px] font-semibold text-[#1F114C] mb-1.5">{t.nineBox.movementHistory}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {history.map((h, i) => (
                          <div key={h.period} className="flex items-center gap-2">
                            {i > 0 && (
                              <svg
                                className="w-4 h-4 text-[#8B8B8B]"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                              >
                                <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                            )}
                            <div
                              className={`px-2 py-1 rounded text-[9px] font-medium ${i === history.length - 1 ? 'ring-1 ring-emerald-400 bg-emerald-100 text-emerald-800 font-bold' : (QUADRANT_COLOR[h.quadrant] ?? 'bg-gray-50 text-gray-700')}`}
                            >
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
                <p className="text-[11px] text-[#8B8B8B]">{t.nineBox.selectEmployeeFromGrid}</p>
              )}
            </div>

            {/* Bench Strength by Critical Role */}
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
              <p className="text-[11px] font-semibold text-[#1F114C] mb-2">{t.nineBox.benchStrengthTitle}</p>
              {successionQ.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : successionQ.isError ? (
                <ErrorState />
              ) : (
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                      <th className="text-left pb-1.5 font-medium">{t.succession.colRole}</th>
                      <th className="text-center pb-1.5 font-medium">{t.succession.readyNow}</th>
                      <th className="text-center pb-1.5 font-medium">{t.nineBox.inDevelopment}</th>
                      <th className="text-center pb-1.5 font-medium">{t.learning.gap}</th>
                    </tr>
                  </thead>
                  <tbody className="text-[#333]">
                    {(successionQ.data ?? []).map((role, i) => {
                      const ready =
                        role.successors?.filter((s: { readiness: string }) => s.readiness === 'ready_now').length ?? 0;
                      const developing =
                        role.successors?.filter((s: { readiness: string }) => s.readiness !== 'ready_now').length ?? 0;
                      const gap = ready === 0 && developing === 0 ? 'critical' : ready === 0 ? 'risk' : 'covered';
                      const gapStyle = BENCH_STATUS[gap] ?? BENCH_STATUS.covered;
                      return (
                        <tr key={role.id} className={`border-b border-[#F6F6F6] ${i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                          <td className="py-1.5">{role.title}</td>
                          <td className="text-center">
                            <span
                              className={`${ready > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'} font-semibold px-1.5 py-0.5 rounded`}
                            >
                              {ready}
                            </span>
                          </td>
                          <td className="text-center">
                            <span className="bg-amber-50 text-amber-700 font-semibold px-1.5 py-0.5 rounded">
                              {developing}
                            </span>
                          </td>
                          <td className="text-center">
                            <span className={gapStyle.cls}>{gapStyle.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {(successionQ.data ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-[#8B8B8B]">
                          {t.nineBox.noCriticalRoles}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Calibration Sessions List */}
          <CalibrationSessionsList
            sessions={sessionsQ.data ?? []}
            isLoading={sessionsQ.isLoading}
            isError={sessionsQ.isError && !sessionsForbidden}
            onManage={(id) => setCalibrationSessionId(id)}
            t={t.committee}
          />

          {/* Auto-Plan by Quadrant */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
            <p className="text-[11px] font-semibold text-[#1F114C] mb-2">{t.nineBox.autoPlanTitle}</p>
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

      {calibrationSessionId && (
        <CalibrationModal
          sessionId={calibrationSessionId}
          period={PERIOD}
          onClose={() => {
            setCalibrationSessionId(null);
            kpisQ.refetch();
          }}
        />
      )}
    </div>
  );
}
