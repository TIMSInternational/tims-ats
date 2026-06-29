'use client';

import { useState } from 'react';
import { CandidateAvatar } from '../../../../components';
import { formatDate } from '../../../../lib/format-utils';
import { useI18n } from '../../../../lib/i18n';

type Phase = 'all' | 'day1_30' | 'day31_60' | 'day61_90';

interface OnboardingTask {
  id: string;
  completed: boolean;
  responsible: string;
  phase: string;
}

interface OnboardingCheckIn {
  id: string;
  status: string;
  type: string;
  scheduledDate: Date | string;
  completedAt: Date | string | null;
}

export interface OnboardingPlan {
  id: string;
  status: string;
  phase: string;
  riskScore: number | null;
  startDate: Date | string;
  completedAt: Date | string | null;
  user: { id: string; firstName: string; lastName: string; avatar: string | null; jobTitle?: string | null };
  buddy: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  tasks: OnboardingTask[];
  checkIns: OnboardingCheckIn[];
}

const PHASE_TABS: { key: Phase; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'day1_30', label: 'Dia 1-30' },
  { key: 'day31_60', label: 'Dia 31-60' },
  { key: 'day61_90', label: 'Dia 61-90' },
];

const PHASE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  day1_30: { bg: 'bg-green-50', text: 'text-green-600', label: 'Dia 1-30' },
  day31_60: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'Dia 31-60' },
  day61_90: { bg: 'bg-purple-50', text: 'text-[#5C4B99]', label: 'Dia 61-90' },
  completed: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Completado' },
};

function getDayCount(startDate: Date | string): number {
  const d = typeof startDate === 'string' ? new Date(startDate) : startDate;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function getRiskDot(score: number | null) {
  const s = score ?? 0;
  if (s > 0.3) return 'bg-[#DD0C15] animate-pulse';
  if (s > 0.15) return 'bg-amber-500';
  return 'bg-green-500';
}

function getProgressColor(pct: number, risk: number) {
  if (risk > 0.3) return { bar: 'bg-[#DD0C15]', text: 'text-[#DD0C15] font-medium' };
  if (risk > 0.15) return { bar: 'bg-amber-500', text: 'text-amber-600' };
  if (pct >= 70) return { bar: 'bg-green-500', text: 'text-[#585858]' };
  return { bar: 'bg-green-500', text: 'text-[#585858]' };
}

function fractionColor(done: number, total: number, risk: number) {
  if (total === 0) return 'text-[#585858]';
  const ratio = done / total;
  if (risk > 0.3 && ratio < 0.5) return 'text-[#DD0C15] font-medium';
  if (ratio >= 0.8) return 'text-green-600 font-medium';
  if (ratio >= 0.5) return 'text-amber-600 font-medium';
  return 'text-[#DD0C15] font-medium';
}

function CheckInBadge({ label, done, overdue }: { label: string; done: boolean; overdue: boolean }) {
  if (done) {
    return <span className="text-[9px] bg-green-50 text-green-600 px-1 py-0.5 rounded">{label} ✓</span>;
  }
  if (overdue) {
    return <span className="text-[9px] bg-[#DD0C15]/10 text-[#DD0C15] px-1 py-0.5 rounded">{label} Vencido!</span>;
  }
  return null;
}

export function OnboardingTable({
  plans,
  isLoading,
  onPhaseChange,
}: {
  plans: OnboardingPlan[];
  isLoading: boolean;
  onPhaseChange: (phase: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<Phase>('all');
  const { t } = useI18n();

  const handleTab = (key: Phase) => {
    setActiveTab(key);
    onPhaseChange(key);
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden mb-6">
      <div className="flex justify-between items-center px-5 py-4 border-b border-[#EDEDED]">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.onboarding.activeNewHires}</h3>
        <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden">
          {PHASE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTab(tab.key)}
              className={`px-3 h-7 text-[11px] font-medium transition ${
                activeTab === tab.key ? 'bg-[#1F114C] text-white' : 'text-[#585858] hover:bg-[#EDEDED]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#FAFAFA] border-b border-[#EDEDED]">
              <th className="text-left py-2.5 px-4 text-[#585858] font-medium w-[200px]">Colaborador</th>
              <th className="text-left py-2.5 px-3 text-[#585858] font-medium">Cargo</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Ingreso</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Dia</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Fase</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Tareas</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Check-in</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Riesgo</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Progreso</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-[#F0F0F0]">
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="py-3 px-4">
                      <div className="h-4 bg-gray-200 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && plans.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-[13px] text-[#8B8B8B]">
                  No hay planes de onboarding activos
                </td>
              </tr>
            )}

            {!isLoading &&
              plans.map((plan, idx) => {
                const day = getDayCount(plan.startDate);
                const risk = plan.riskScore ?? 0;
                const isAtRisk = risk > 0.3;
                const isWarning = risk > 0.15 && risk <= 0.3;

                const totalTasks = plan.tasks.length;
                const doneTasks = plan.tasks.filter((t) => t.completed).length;
                const taskPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
                const colors = getProgressColor(taskPct, risk);

                const phase = PHASE_BADGE[plan.phase] ?? PHASE_BADGE.day1_30;

                // Check-in milestones
                const checkInDone = (type: string) => plan.checkIns.some((c) => c.type === type && c.status === 'completed');
                const checkInOverdue = (type: string) => {
                  const ci = plan.checkIns.find((c) => c.type === type);
                  if (!ci || ci.status === 'completed') return false;
                  return new Date(ci.scheduledDate) < new Date();
                };

                // Derive check-in status from day count if no typed check-ins
                const hasTypedCheckIns = plan.checkIns.length > 0 && plan.checkIns.some((c) => c.type);
                const day1Done = hasTypedCheckIns ? checkInDone('day1') : day >= 1 && plan.checkIns.some((c) => c.status === 'completed');
                const day30Done = hasTypedCheckIns ? checkInDone('day30') : day >= 30 && plan.checkIns.filter((c) => c.status === 'completed').length >= 2;
                const day30Overdue = !day30Done && day > 30;
                const day60Done = hasTypedCheckIns ? checkInDone('day60') : day >= 60 && plan.checkIns.filter((c) => c.status === 'completed').length >= 3;
                const day60Overdue = !day60Done && day > 60;

                return (
                  <tr
                    key={plan.id}
                    className={`border-b border-[#F0F0F0] hover:bg-[#FAFAFA] cursor-pointer transition ${
                      idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''
                    } ${isAtRisk ? 'border-l-[3px] border-l-[#DD0C15]' : isWarning ? 'border-l-[3px] border-l-amber-500' : ''}`}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <CandidateAvatar firstName={plan.user.firstName} lastName={plan.user.lastName} avatar={plan.user.avatar} size="sm" />
                        <div>
                          <p className="text-[12px] font-medium text-[#333]">{plan.user.firstName} {plan.user.lastName}</p>
                          {plan.buddy ? (
                            <p className="text-[10px] text-[#8B8B8B]">Buddy: {plan.buddy.firstName} {plan.buddy.lastName.charAt(0)}.</p>
                          ) : (
                            <p className="text-[10px] text-[#DD0C15] font-medium">{t.onboarding.noBuddyAssigned}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-[11px] text-[#333]">{plan.user.jobTitle ?? '—'}</td>

                    <td className="py-3 px-3 text-[11px] text-[#585858] text-center">{formatDate(plan.startDate)}</td>

                    <td className="py-3 px-3 text-center">
                      <span className={`text-[12px] font-bold ${day > 60 ? 'text-[#5C4B99]' : day > 30 ? 'text-amber-600' : 'text-[#1F114C]'}`}>{day}</span>
                      <span className="text-[10px] text-[#8B8B8B]">/90</span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span className={`text-[10px] ${phase.bg} ${phase.text} px-2 py-0.5 rounded-full font-medium`}>{phase.label}</span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span className={`text-[11px] ${fractionColor(doneTasks, totalTasks, risk)}`}>{doneTasks}/{totalTasks}</span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col gap-0.5 items-center">
                        <CheckInBadge label="Dia 1" done={day1Done} overdue={false} />
                        {day >= 25 && <CheckInBadge label="Dia 30" done={day30Done} overdue={day30Overdue} />}
                        {day >= 55 && <CheckInBadge label="Dia 60" done={day60Done} overdue={day60Overdue} />}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span className={`w-2.5 h-2.5 rounded-full ${getRiskDot(plan.riskScore)} inline-block`} />
                    </td>

                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 justify-center">
                        <div className="w-20 bg-[#F6F6F6] rounded-full h-2">
                          <div className={`h-2 ${colors.bar} rounded-full transition-all`} style={{ width: `${taskPct}%` }} />
                        </div>
                        <span className={`text-[10px] ${colors.text}`}>{taskPct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
