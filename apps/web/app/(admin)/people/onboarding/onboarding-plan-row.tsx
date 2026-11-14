'use client';

import React from 'react';
import { Button, CandidateAvatar, ProgressBar, StatusBadge } from '../../../../components';
import { formatDate } from '../../../../lib/format-utils';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { derivedOnboardingPhase, isPastDue, isTaskOverdue, onboardingDay } from '../../../../lib/onboarding-schedule';
import { onboardingCheckInTypeLabel } from '../../../../lib/onboarding-labels';
import { CheckInBadge } from './check-in-badge';
import { OnboardingBuddyCell } from './onboarding-buddy-cell';
import { PHASE_TONE, RISK_TONE, fractionColor, getProgressColor, getRiskLevel } from './onboarding-table-colors';
import type { OnboardingPlan } from './onboarding-table';

/** The milestones the table summarizes (scheduledOnboardingCheckIns seeds day1/day30/day60). */
const CHECK_IN_TYPES = ['day1', 'day30', 'day60'] as const;

// Below md each row becomes a stacked card (two columns, the person across the top); from md it is a
// normal table row. One DOM for both, so every row keeps its "Ver tareas" button and cell order.
const ROW = 'border-b border-border max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-3 max-md:p-4';
const CELL = 'py-3 px-3 md:text-center max-md:block max-md:p-0';

/** The column name shown inside a stacked cell on phones (the table header is hidden there). */
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-0.5 block text-caption font-medium text-secondary md:hidden">{children}</span>;
}

interface OnboardingPlanRowProps {
  plan: OnboardingPlan;
  expanded: boolean;
  onToggle: () => void;
  tasksId: string;
  canUpdate: boolean;
  phaseLabel: (key: string) => string;
}

export function OnboardingPlanRow({
  plan,
  expanded,
  onToggle,
  tasksId,
  canUpdate,
  phaseLabel,
}: OnboardingPlanRowProps) {
  const { t } = useI18n();
  const day = plan.currentDay ?? onboardingDay(plan.startDate);
  // riskScore is only written by updatePlan; until something computes it there is no score to show.
  const hasRisk = plan.riskScore !== null && plan.riskScore !== undefined;
  const riskLevel = getRiskLevel(plan.riskScore ?? 0);
  const riskLabel = { high: t.onboarding.riskHigh, medium: t.onboarding.riskMedium, low: t.onboarding.riskLow }[
    riskLevel
  ];

  const totalTasks = plan.tasks.length;
  const doneTasks = plan.tasks.filter((task) => task.completed).length;
  const taskPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const hasOverdue = plan.tasks.some((task) => isTaskOverdue(task));
  const colors = getProgressColor(hasOverdue);

  // The stored phase never advances; show the phase the start date puts the hire in today.
  const phaseKey =
    plan.status === 'completed' ? 'completed' : (plan.currentPhase ?? derivedOnboardingPhase(plan.startDate));
  const hireName = `${plan.user.firstName} ${plan.user.lastName}`;

  const checkInDone = (type: string) => plan.checkIns.some((c) => c.type === type && c.status === 'completed');
  const checkInOverdue = (type: string) => {
    const ci = plan.checkIns.find((c) => c.type === type);
    if (!ci || ci.status === 'completed') return false;
    return isPastDue(ci.scheduledDate);
  };
  const hasCheckIn = (type: string) => plan.checkIns.some((c) => c.type === type);

  return (
    <tr className={`${ROW} ${hasOverdue ? 'md:border-l-[3px] md:border-l-danger' : ''}`}>
      <td className="px-4 py-3 max-md:col-span-2 max-md:block max-md:p-0">
        <div className="flex items-center gap-2.5">
          <CandidateAvatar
            firstName={plan.user.firstName}
            lastName={plan.user.lastName}
            avatar={plan.user.avatar}
            size="sm"
            decorative
          />
          <div className="min-w-0">
            <p className="text-body font-medium text-primary">{hireName}</p>
            <OnboardingBuddyCell planId={plan.id} hire={plan.user} buddy={plan.buddy} canAssign={canUpdate} />
          </div>
        </div>
      </td>

      <td className="px-3 py-3 text-body text-primary max-md:block max-md:p-0">
        <CellLabel>{t.onboarding.colJobTitle}</CellLabel>
        {plan.user.jobTitle ?? '—'}
      </td>

      <td className={`${CELL} text-callout tabular-nums text-secondary`}>
        <CellLabel>{t.onboarding.colStartDate}</CellLabel>
        {formatDate(plan.startDate)}
      </td>

      <td className={CELL}>
        <CellLabel>{t.onboarding.colDay}</CellLabel>
        <span className="text-body font-semibold tabular-nums text-primary">{day}</span>
        <span className="text-callout text-muted">/90</span>
      </td>

      <td className={CELL}>
        <CellLabel>{t.onboarding.colPhase}</CellLabel>
        <StatusBadge tone={PHASE_TONE[phaseKey] ?? 'brand'}>{phaseLabel(phaseKey)}</StatusBadge>
      </td>

      <td className={CELL}>
        <CellLabel>{t.onboarding.tasksLabel}</CellLabel>
        <div className="flex flex-col items-start gap-0.5 md:items-center">
          <span className={`text-callout tabular-nums ${fractionColor(hasOverdue)}`}>
            {doneTasks}/{totalTasks}
          </span>
          <Button
            variant="tertiary"
            size="sm"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={expanded ? tasksId : undefined}
            className="-mx-2 px-2"
          >
            {expanded ? t.onboarding.collapseTasks : t.onboarding.expandTasks}
            <svg
              className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </Button>
        </div>
      </td>

      <td className={CELL}>
        <CellLabel>{t.onboarding.colCheckIn}</CellLabel>
        <div className="flex flex-col items-start gap-1 md:items-center">
          {CHECK_IN_TYPES.filter(hasCheckIn).map((type) => (
            <CheckInBadge
              key={type}
              label={onboardingCheckInTypeLabel(t.myOnboarding.labels, type)}
              done={checkInDone(type)}
              overdue={checkInOverdue(type)}
            />
          ))}
          {plan.checkIns.length === 0 && <span className="text-callout text-muted">—</span>}
        </div>
      </td>

      <td className={CELL}>
        <CellLabel>{t.onboarding.colRisk}</CellLabel>
        {hasRisk ? (
          <StatusBadge tone={RISK_TONE[riskLevel]}>{riskLabel}</StatusBadge>
        ) : (
          <span className="text-callout text-muted" title={t.onboarding.riskNotCalculated}>
            —<span className="sr-only">{t.onboarding.riskNotCalculated}</span>
          </span>
        )}
      </td>

      <td className="px-3 py-3 max-md:col-span-2 max-md:block max-md:p-0">
        <CellLabel>{t.onboarding.colProgress}</CellLabel>
        <div className="flex items-center gap-1.5 md:justify-center">
          <ProgressBar
            value={taskPct}
            label={formatMessage(t.onboarding.progressOf, { name: hireName })}
            hideLabel
            tone={colors.tone}
            className="w-full md:w-20"
          />
          <span className={`text-callout tabular-nums ${colors.text}`}>{taskPct}%</span>
        </div>
      </td>
    </tr>
  );
}
