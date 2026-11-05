'use client';

import React, { useState } from 'react';
import { CandidateAvatar } from '../../../../components';
import { formatDate } from '../../../../lib/format-utils';
import { useI18n } from '../../../../lib/i18n';
import { useCan } from '../../../../lib/permissions';
import { derivedOnboardingPhase, isPastDue, onboardingDay } from '../../../../lib/onboarding-schedule';
import { onboardingCheckInTypeLabel } from '../../../../lib/onboarding-labels';
import { OnboardingTaskList } from './onboarding-task-list';
import { CreateTaskModal } from './create-task-modal';
import { CheckInBadge } from './check-in-badge';
import { OnboardingBuddyCell } from './onboarding-buddy-cell';
import { PHASE_BADGE, fractionColor, getProgressColor, getRiskDot } from './onboarding-table-colors';

type Phase = 'all' | 'day1_30' | 'day31_60' | 'day61_90';

interface OnboardingTask {
  id: string;
  title: string;
  completed: boolean;
  responsible: string;
  phase: string;
  dueDate?: Date | string | null;
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
  /** Day and phase today in the ORGANIZATION's zone (onboarding.list) — the basis the phase tabs filter on. */
  currentDay?: number;
  currentPhase?: 'day1_30' | 'day31_60' | 'day61_90';
  user: { id: string; firstName: string; lastName: string; avatar: string | null; jobTitle?: string | null };
  buddy: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  tasks: OnboardingTask[];
  checkIns: OnboardingCheckIn[];
}

const PHASE_KEYS: readonly Phase[] = ['all', 'day1_30', 'day31_60', 'day61_90'];
/** The milestones the table summarizes (scheduledOnboardingCheckIns seeds day1/day30/day60). */
const CHECK_IN_TYPES = ['day1', 'day30', 'day60'] as const;

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [taskPlan, setTaskPlan] = useState<OnboardingPlan | null>(null);
  const { t } = useI18n();
  const can = useCan();
  const canUpdate = can('onboarding', 'update');
  const canCreateTask = can('onboarding', 'create');
  const phaseLabels: Record<Phase | 'completed', string> = {
    all: t.onboarding.phaseAll,
    day1_30: t.onboarding.phaseDay1_30,
    day31_60: t.onboarding.phaseDay31_60,
    day61_90: t.onboarding.phaseDay61_90,
    completed: t.myOnboarding.labels.statuses.completed,
  };
  const phaseLabel = (key: Phase | 'completed'): string => phaseLabels[key];

  const handleTab = (key: Phase) => {
    setActiveTab(key);
    onPhaseChange(key);
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden mb-6">
      <div className="flex justify-between items-center px-5 py-4 border-b border-[#EDEDED]">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.onboarding.activeNewHires}</h3>
        <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden">
          {PHASE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTab(key)}
              aria-pressed={activeTab === key}
              className={`px-3 h-7 text-[11px] font-medium transition ${
                activeTab === key ? 'bg-[#1F114C] text-white' : 'text-[#585858] hover:bg-[#EDEDED]'
              }`}
            >
              {phaseLabel(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#FAFAFA] border-b border-[#EDEDED]">
              <th className="text-left py-2.5 px-4 text-[#585858] font-medium w-[200px]">{t.onboarding.colEmployee}</th>
              <th className="text-left py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.colJobTitle}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.colStartDate}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.colDay}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.colPhase}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.tasksLabel}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.colCheckIn}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.colRisk}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.onboarding.colProgress}</th>
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
                  {t.onboarding.noPlan}
                </td>
              </tr>
            )}

            {!isLoading &&
              plans.map((plan, idx) => {
                const day = plan.currentDay ?? onboardingDay(plan.startDate);
                // riskScore is only written by updatePlan; until something computes it there is no score to show.
                const hasRisk = plan.riskScore !== null && plan.riskScore !== undefined;
                const risk = plan.riskScore ?? 0;
                const isAtRisk = risk > 0.3;
                const isWarning = risk > 0.15 && risk <= 0.3;

                const totalTasks = plan.tasks.length;
                const doneTasks = plan.tasks.filter((t) => t.completed).length;
                const taskPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
                const colors = getProgressColor(risk);

                // The stored phase never advances; show the phase the start date puts the hire in today.
                const phaseKey =
                  plan.status === 'completed' ? 'completed' : (plan.currentPhase ?? derivedOnboardingPhase(plan.startDate));
                const phase = PHASE_BADGE[phaseKey] ?? PHASE_BADGE.day1_30;

                // Check-in milestones
                const checkInDone = (type: string) =>
                  plan.checkIns.some((c) => c.type === type && c.status === 'completed');
                const checkInOverdue = (type: string) => {
                  const ci = plan.checkIns.find((c) => c.type === type);
                  if (!ci || ci.status === 'completed') return false;
                  return isPastDue(ci.scheduledDate);
                };

                const hasCheckIn = (type: string) => plan.checkIns.some((c) => c.type === type);

                return (
                  <React.Fragment key={plan.id}>
                    <tr
                      className={`border-b border-[#F0F0F0] hover:bg-[#FAFAFA] cursor-pointer transition ${
                        idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''
                      } ${isAtRisk ? 'border-l-[3px] border-l-[#DD0C15]' : isWarning ? 'border-l-[3px] border-l-amber-500' : ''}`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <CandidateAvatar
                            firstName={plan.user.firstName}
                            lastName={plan.user.lastName}
                            avatar={plan.user.avatar}
                            size="sm"
                          />
                          <div>
                            <p className="text-[12px] font-medium text-[#333]">
                              {plan.user.firstName} {plan.user.lastName}
                            </p>
                            <OnboardingBuddyCell planId={plan.id} hire={plan.user} buddy={plan.buddy} canAssign={canUpdate} />
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-[11px] text-[#333]">{plan.user.jobTitle ?? '—'}</td>

                      <td className="py-3 px-3 text-[11px] text-[#585858] text-center">{formatDate(plan.startDate)}</td>

                      <td className="py-3 px-3 text-center">
                        <span
                          className={`text-[12px] font-bold ${day > 60 ? 'text-[#5C4B99]' : day > 30 ? 'text-amber-600' : 'text-[#1F114C]'}`}
                        >
                          {day}
                        </span>
                        <span className="text-[10px] text-[#8B8B8B]">/90</span>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <span className={`text-[10px] ${phase.bg} ${phase.text} px-2 py-0.5 rounded-full font-medium`}>
                          {phaseLabel(phaseKey)}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`text-[11px] ${fractionColor(doneTasks, totalTasks, risk)}`}>
                            {doneTasks}/{totalTasks}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded((prev) => (prev === plan.id ? null : plan.id));
                            }}
                            className="text-[9px] text-[#1F114C] underline hover:text-[#DD0C15] transition"
                          >
                            {t.onboarding.expandTasks}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <div className="flex flex-col gap-0.5 items-center">
                          {CHECK_IN_TYPES.filter(hasCheckIn).map((type) => (
                            <CheckInBadge
                              key={type}
                              label={onboardingCheckInTypeLabel(t.myOnboarding.labels, type)}
                              done={checkInDone(type)}
                              overdue={checkInOverdue(type)}
                            />
                          ))}
                          {plan.checkIns.length === 0 && <span className="text-[10px] text-[#8B8B8B]">—</span>}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        {hasRisk ? (
                          <span className={`w-2.5 h-2.5 rounded-full ${getRiskDot(risk)} inline-block`} />
                        ) : (
                          <span className="text-[10px] text-[#8B8B8B]" title={t.onboarding.riskNotCalculated}>
                            —<span className="sr-only">{t.onboarding.riskNotCalculated}</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-20 bg-[#F6F6F6] rounded-full h-2">
                            <div
                              className={`h-2 ${colors.bar} rounded-full transition-all`}
                              style={{ width: `${taskPct}%` }}
                            />
                          </div>
                          <span className={`text-[10px] ${colors.text}`}>{taskPct}%</span>
                        </div>
                      </td>
                    </tr>
                    {expanded === plan.id && (
                      <>
                        <OnboardingTaskList tasks={plan.tasks} canToggle={canUpdate} />
                        {canCreateTask && (
                          <tr className="bg-[#F9F9FB]">
                            <td colSpan={9} className="px-6 pb-3">
                              <button type="button" onClick={() => setTaskPlan(plan)} className="text-[11px] font-medium text-[#1F114C] underline">{t.onboarding.createTaskTitle}</button>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </React.Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
      {taskPlan && <CreateTaskModal planId={taskPlan.id} phase={derivedOnboardingPhase(taskPlan.startDate)} onClose={() => setTaskPlan(null)} />}
    </div>
  );
}
