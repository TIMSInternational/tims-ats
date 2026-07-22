'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { ErrorState, Skeleton } from '../../../../components';
import { RequestAdjustmentModal } from './request-adjustment-modal';

interface Successor {
  id: string;
  readiness: string;
  type: string;
  user: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}

interface CriticalRole {
  id: string;
  title: string;
  criticality: string;
  flightRisk?: number | null;
  targetBandLevel?: string | null;
  currentHolder?: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null } | null;
  successors: Successor[];
}

interface SalaryBandOption {
  level: string;
  title?: string | null;
}

interface CompGapAlert {
  successorId: string;
  roleId: string;
  userId: string;
  currentSalary: number;
  currency: string;
  midSalary: number;
  bandLevel: string;
  gapPercent: number;
}

interface SuccessionPipelineProps {
  roles: CriticalRole[];
  loading: boolean;
  isError: boolean;
  bands: SalaryBandOption[];
  compGapAlerts: CompGapAlert[];
  t: {
    successionPipeline: string;
    readyNow: string;
    in1to2Years: string;
    external: string;
    riskHigh: string;
    riskMedium: string;
    riskLow: string;
    noSuccessor: string;
    noSuccessorsIdentified: string;
    assignSuccessor: string;
    targetBandLabel: string;
    targetBandNone: string;
    targetBandUpdateSuccess: string;
    targetBandUpdateError: string;
    compGapBadge: string;
    compGapBadgeDesc: string;
    requestAdjustment: string;
  };
}

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

const RISK_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  high: { bg: 'bg-red-50', text: 'text-[#DD0C15]', dot: 'bg-[#DD0C15]' },
  medium: { bg: 'bg-orange-50', text: 'text-orange-600', dot: 'bg-orange-500' },
  low: { bg: 'bg-green-50', text: 'text-green-600', dot: 'bg-green-500' },
};

const READINESS_STYLES: Record<string, { border: string; bg: string; label: string; text: string; avatarBg: string }> = {
  ready_now: { border: 'border-green-300', bg: 'bg-green-50/50', label: 'Ready Now', text: 'text-green-700', avatarBg: 'bg-green-600' },
  ready_1_year: { border: 'border-amber-300', bg: 'bg-amber-50/50', label: '1-2 Anos', text: 'text-amber-700', avatarBg: 'bg-amber-600' },
  ready_2_years: { border: 'border-amber-300', bg: 'bg-amber-50/50', label: '1-2 Anos', text: 'text-amber-700', avatarBg: 'bg-amber-600' },
  developing: { border: 'border-blue-300', bg: 'bg-blue-50/50', label: 'Externo', text: 'text-blue-700', avatarBg: 'bg-blue-600' },
  external: { border: 'border-blue-300', bg: 'bg-blue-50/50', label: 'Externo', text: 'text-blue-700', avatarBg: 'bg-blue-600' },
};

const AVATAR_COLORS = ['bg-[#1F114C]', 'bg-violet-600', 'bg-teal-600', 'bg-blue-600', 'bg-pink-600'];

export function SuccessionPipeline({ roles, loading, isError, bands, compGapAlerts, t }: SuccessionPipelineProps) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [adjustmentTarget, setAdjustmentTarget] = useState<{
    userId: string;
    employeeName: string;
    previousSalary: number;
    suggestedNewSalary: number;
  } | null>(null);

  const updateBand = trpc.succession.updateCriticalRoleBand.useMutation({
    onSuccess: () => {
      utils.succession.listCriticalRoles.invalidate();
      utils.succession.getCompGapAlerts.invalidate();
      // Cutover parity: refresh the C# platform-api succession reads. No-op under tRPC.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
      toast(t.targetBandUpdateSuccess, { type: 'success' });
    },
    onError: () => toast(t.targetBandUpdateError, { type: 'error' }),
  });

  if (loading) {
    return (
      <div className="w-full md:w-[55%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <Skeleton className="h-4 w-48 mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full mb-3" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="w-full md:w-[55%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.successionPipeline}</h3>
        <ErrorState />
      </div>
    );
  }

  function getRiskLevel(risk?: number | null): string {
    if (!risk || risk < 0.5) return 'low';
    if (risk < 0.8) return 'medium';
    return 'high';
  }

  function getRiskLabel(level: string) {
    if (level === 'high') return t.riskHigh;
    if (level === 'medium') return t.riskMedium;
    return t.riskLow;
  }

  function compGapFor(successorId: string) {
    return compGapAlerts.find((a) => a.successorId === successorId);
  }

  return (
    <div className="w-full md:w-[55%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 overflow-y-auto max-h-[370px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.successionPipeline}</h3>
        <span className="text-[10px] text-[#8B8B8B]">{roles.length} roles criticos principales</span>
      </div>

      {roles.map((role, idx) => {
        const riskLevel = getRiskLevel(role.flightRisk);
        const riskStyle = RISK_STYLES[riskLevel] ?? RISK_STYLES.low;
        const noSuccessor = role.successors.length === 0;
        const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];

        return (
          <div
            key={role.id}
            className={`mb-3 border rounded-lg p-3 ${noSuccessor ? 'border-red-200 bg-red-50/30' : 'border-[#EDEDED]'}`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-2 flex-1">
                <div className={`w-8 h-8 rounded-full ${avatarColor} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                  {role.currentHolder ? getInitials(role.currentHolder.firstName, role.currentHolder.lastName) : '??'}
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-[#1F114C]">{role.title}</p>
                  <p className="text-[10px] text-[#585858]">
                    {role.currentHolder ? `${role.currentHolder.firstName} ${role.currentHolder.lastName}` : 'Vacante'}
                  </p>
                </div>
              </div>
              {noSuccessor ? (
                <span className="text-[9px] bg-red-100 text-[#DD0C15] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                  </svg>
                  {t.noSuccessor}
                </span>
              ) : (
                <span className={`text-[9px] ${riskStyle.bg} ${riskStyle.text} px-2 py-0.5 rounded-full font-medium flex items-center gap-1`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${riskStyle.dot}`} />
                  {getRiskLabel(riskLevel)}
                </span>
              )}
            </div>

            {/* Sprint 1.4 Task 4 — minimal inline target-band control. Not a
                new page/form: a single select wired to the single-field
                updateCriticalRoleBand mutation. */}
            <div className="flex items-center gap-1.5 mb-2 ml-11">
              <span className="text-[9px] text-[#8B8B8B]">{t.targetBandLabel}:</span>
              <select
                value={role.targetBandLevel ?? ''}
                onChange={(e) =>
                  updateBand.mutate({
                    criticalRoleId: role.id,
                    targetBandLevel: e.target.value || null,
                  })
                }
                disabled={updateBand.isPending}
                className="text-[9px] border border-[#EDEDED] rounded px-1.5 py-0.5 text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
              >
                <option value="">{t.targetBandNone}</option>
                {bands.map((b) => (
                  <option key={b.level} value={b.level}>
                    {b.title ? `${b.level} — ${b.title}` : b.level}
                  </option>
                ))}
              </select>
            </div>

            <div className={`ml-6 pl-4 border-l-2 border-dashed ${noSuccessor ? 'border-red-200' : 'border-[#EDEDED]'}`}>
              {noSuccessor ? (
                <div className="border border-red-200 bg-red-50 rounded-lg p-2 text-center">
                  <p className="text-[10px] text-[#DD0C15] font-medium">{t.noSuccessorsIdentified}</p>
                  <button className="text-[9px] text-white bg-[#DD0C15] px-3 py-1 rounded mt-1 font-medium">
                    {t.assignSuccessor}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  {role.successors.map((s) => {
                    const style = READINESS_STYLES[s.readiness] ?? READINESS_STYLES.developing;
                    const gap = compGapFor(s.id);
                    return (
                      <div key={s.id} className={`flex-1 border ${style.border} ${style.bg} rounded-lg p-2`}>
                        <p className={`text-[9px] ${style.text} font-semibold mb-1`}>{style.label}</p>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-6 h-6 rounded-full ${style.avatarBg} flex items-center justify-center text-white text-[8px] font-bold`}>
                            {getInitials(s.user.firstName, s.user.lastName)}
                          </div>
                          <div>
                            <p className="text-[10px] font-medium text-[#333]">{s.user.firstName} {s.user.lastName}</p>
                            <p className="text-[9px] text-[#8B8B8B]">{s.user.jobTitle ?? ''}</p>
                          </div>
                        </div>
                        {gap && (
                          <div className="mt-1.5 pt-1.5 border-t border-dashed border-amber-300">
                            <span className="text-[8px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-semibold">
                              {t.compGapBadge} -{gap.gapPercent}% {t.compGapBadgeDesc}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setAdjustmentTarget({
                                  userId: gap.userId,
                                  employeeName: `${s.user.firstName} ${s.user.lastName}`,
                                  previousSalary: gap.currentSalary,
                                  suggestedNewSalary: gap.midSalary,
                                })
                              }
                              className="block mt-1 text-[8px] text-white bg-[#1F114C] px-2 py-1 rounded font-medium hover:bg-[#2a1866] transition"
                            >
                              {t.requestAdjustment}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {adjustmentTarget && (
        <RequestAdjustmentModal
          userId={adjustmentTarget.userId}
          employeeName={adjustmentTarget.employeeName}
          previousSalary={adjustmentTarget.previousSalary}
          suggestedNewSalary={adjustmentTarget.suggestedNewSalary}
          onClose={() => setAdjustmentTarget(null)}
        />
      )}
    </div>
  );
}
