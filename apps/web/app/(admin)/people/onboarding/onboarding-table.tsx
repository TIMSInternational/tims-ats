'use client';

import React, { useState } from 'react';
import { Button, EmptyState, Skeleton } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { useCan } from '../../../../lib/permissions';
import { derivedOnboardingPhase } from '../../../../lib/onboarding-schedule';
import { OnboardingTaskList } from './onboarding-task-list';
import { CreateTaskModal } from './create-task-modal';
import { OnboardingPlanRow } from './onboarding-plan-row';

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
const TH = 'px-3 py-2.5 text-center font-medium text-secondary';

export function OnboardingTable({
  plans,
  isLoading,
  onPhaseChange,
  onCreatePlan,
}: {
  plans: OnboardingPlan[];
  isLoading: boolean;
  onPhaseChange: (phase: string) => void;
  /** The empty state's next step, when the viewer may create plans. */
  onCreatePlan?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<Phase>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [taskPlan, setTaskPlan] = useState<OnboardingPlan | null>(null);
  const { t } = useI18n();
  const can = useCan();
  const canUpdate = can('onboarding', 'update');
  const canCreateTask = can('onboarding', 'create');
  const phaseLabels: Record<string, string> = {
    all: t.onboarding.phaseAll,
    day1_30: t.onboarding.phaseDay1_30,
    day31_60: t.onboarding.phaseDay31_60,
    day61_90: t.onboarding.phaseDay61_90,
    completed: t.myOnboarding.labels.statuses.completed,
  };
  const phaseLabel = (key: string): string => phaseLabels[key] ?? key;

  const handleTab = (key: Phase) => {
    setActiveTab(key);
    onPhaseChange(key);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-card" aria-labelledby="onboarding-hires-heading">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <h2 id="onboarding-hires-heading" className="text-subheading font-semibold text-primary">
          {t.onboarding.activeNewHires}
        </h2>
        <div role="group" aria-label={t.onboarding.phaseFilterLabel} className="flex flex-wrap gap-1 rounded-lg bg-surface p-0.5">
          {PHASE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTab(key)}
              aria-pressed={activeTab === key}
              className={`h-7 whitespace-nowrap rounded-md px-3 text-callout font-medium transition-colors duration-150 pointer-coarse:min-h-11 ${
                activeTab === key ? 'bg-brand text-white' : 'text-secondary hover:bg-border'
              }`}
            >
              {phaseLabel(key)}
            </button>
          ))}
        </div>
      </div>

      <table className="w-full text-body max-md:block">
        <thead className="max-md:hidden">
          <tr className="border-b border-border bg-surface">
            <th scope="col" className="w-[200px] px-4 py-2.5 text-left font-medium text-secondary">{t.onboarding.colEmployee}</th>
            <th scope="col" className="px-3 py-2.5 text-left font-medium text-secondary">{t.onboarding.colJobTitle}</th>
            <th scope="col" className={TH}>{t.onboarding.colStartDate}</th>
            <th scope="col" className={TH}>{t.onboarding.colDay}</th>
            <th scope="col" className={TH}>{t.onboarding.colPhase}</th>
            <th scope="col" className={TH}>{t.onboarding.tasksLabel}</th>
            <th scope="col" className={TH}>{t.onboarding.colCheckIn}</th>
            <th scope="col" className={TH}>{t.onboarding.colRisk}</th>
            <th scope="col" className={TH}>{t.onboarding.colProgress}</th>
          </tr>
        </thead>
        <tbody className="max-md:block" aria-busy={isLoading || undefined}>
          {isLoading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-border max-md:block">
                {Array.from({ length: 9 }).map((__, j) => (
                  <td key={j} className="px-4 py-3 max-md:block max-md:py-1">
                    <Skeleton className="h-4" />
                  </td>
                ))}
              </tr>
            ))}

          {!isLoading && plans.length === 0 && (
            <tr className="max-md:block">
              <td colSpan={9} className="max-md:block">
                <EmptyState
                  title={t.onboarding.noPlan}
                  description={t.onboarding.noPlanDesc}
                  action={onCreatePlan ? { label: t.onboarding.createPlanTitle, onClick: onCreatePlan, variant: 'secondary' } : undefined}
                />
              </td>
            </tr>
          )}

          {!isLoading &&
            plans.map((plan) => {
              const isOpen = expanded === plan.id;
              const tasksId = `onboarding-tasks-${plan.id}`;
              return (
                <React.Fragment key={plan.id}>
                  <OnboardingPlanRow
                    plan={plan}
                    expanded={isOpen}
                    onToggle={() => setExpanded((prev) => (prev === plan.id ? null : plan.id))}
                    tasksId={tasksId}
                    canUpdate={canUpdate}
                    phaseLabel={phaseLabel}
                  />
                  {isOpen && (
                    <>
                      <OnboardingTaskList tasks={plan.tasks} canToggle={canUpdate} firstRowId={tasksId} />
                      {canCreateTask && (
                        <tr className="border-b border-border bg-surface-hover max-md:block">
                          <td colSpan={9} className="px-4 pb-3 md:px-6 max-md:block">
                            <Button variant="tertiary" size="sm" onClick={() => setTaskPlan(plan)} className="-ml-3">
                              {t.onboarding.createTaskTitle}
                            </Button>
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
      {taskPlan && <CreateTaskModal planId={taskPlan.id} phase={derivedOnboardingPhase(taskPlan.startDate)} onClose={() => setTaskPlan(null)} />}
    </section>
  );
}
