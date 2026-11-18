'use client';

import type { OnboardingPlan } from './onboarding-table';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { StatusBadge } from '../../../../components';
import { onboardingOwnerLabel } from '../../../../lib/onboarding-labels';
import { formatDueDate, isTaskOverdue, sortByDueDate } from '../../../../lib/onboarding-schedule';

// Task `responsible` is a slug for the default checklist (hr | it | manager |
// buddy | employee — onboarding-defaults.ts) or free text HR typed by hand.
// Colors are keyed on the SLUGS; free text falls back to gray. Labels go through
// the shared helper with the ADMIN owner map ("employee" = the new hire; the
// self-service map says "You", which is wrong on this page).
const OWNER_COLORS: Record<string, { bar: string; dot: string }> = {
  hr: { bar: 'bg-[#1F114C]', dot: 'bg-[#1F114C]' },
  manager: { bar: 'bg-[#5C4B99]', dot: 'bg-[#5C4B99]' },
  it: { bar: 'bg-blue-500', dot: 'bg-blue-500' },
  buddy: { bar: 'bg-green-500', dot: 'bg-green-500' },
  employee: { bar: 'bg-amber-500', dot: 'bg-amber-500' },
};
const FALLBACK_COLORS = { bar: 'bg-gray-500', dot: 'bg-gray-500' };
const CARD = 'w-full rounded-xl border border-border bg-white p-4 shadow-card md:flex-1 md:p-5';

function useOwnerLabel(): (responsible: string) => string {
  const { t } = useI18n();
  const messages = { ...t.myOnboarding.labels, owners: t.onboarding.ownerLabels };
  return (responsible) => (responsible ? onboardingOwnerLabel(messages, responsible) : t.onboarding.ownerUnassigned);
}

function DocIcon({ urgent }: { urgent: boolean }) {
  return (
    <svg
      className={`size-4 shrink-0 ${urgent ? 'text-danger' : 'text-secondary'}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

export function TasksByResponsible({ plans }: { plans: OnboardingPlan[] }) {
  const { t } = useI18n();
  const ownerLabel = useOwnerLabel();
  const allTasks = plans.flatMap((p) => p.tasks);
  // Grouped by the raw slug (so colors match); labelled only at render time.
  const byRole: Record<string, { total: number; done: number }> = {};
  for (const task of allTasks) {
    const role = task.responsible;
    if (!byRole[role]) byRole[role] = { total: 0, done: 0 };
    byRole[role].total++;
    if (task.completed) byRole[role].done++;
  }

  const roles = Object.entries(byRole).sort((a, b) => b[1].total - a[1].total);
  // Red only when an owner really has overdue work, never because a plan is simply young.
  const overdueByRole = new Set(allTasks.filter((task) => isTaskOverdue(task)).map((task) => task.responsible));
  const lowestRole =
    roles.length > 0
      ? roles.reduce((min, r) =>
          r[1].total > 0 && r[1].done / r[1].total < (min[1].total > 0 ? min[1].done / min[1].total : 1) ? r : min,
        )
      : null;

  return (
    <section className={CARD}>
      <h2 className="mb-3 text-subheading font-semibold text-primary">{t.onboarding.tasksByResponsible}</h2>
      <div className="space-y-3">
        {roles.map(([role, { total, done }]) => {
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const colors = OWNER_COLORS[role] ?? FALLBACK_COLORS;
          return (
            <div key={role}>
              <div className="flex justify-between items-center mb-1.5">
                <span className="flex items-center gap-1.5 text-body font-medium text-primary">
                  <span className={`size-2.5 rounded-full ${colors.dot}`} aria-hidden="true" />
                  {ownerLabel(role)}
                </span>
                <span className={`text-callout font-medium tabular-nums ${overdueByRole.has(role) ? 'text-danger' : 'text-secondary'}`}>
                  {formatMessage(t.onboarding.tasksDoneOfTotal, { done, total })}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-surface" aria-hidden="true">
                <div className={`h-2.5 ${colors.bar} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {roles.length === 0 && <p className="text-callout text-secondary">{t.onboarding.noTasksRegistered}</p>}
      </div>
      {lowestRole && lowestRole[1].total > 0 && (
        <p
          className={`mt-3 border-t border-border pt-3 text-callout ${
            overdueByRole.has(lowestRole[0]) ? 'font-medium text-danger' : 'text-secondary'
          }`}
        >
          {formatMessage(t.onboarding.lowestProgressAlert, {
            owner: ownerLabel(lowestRole[0]),
            pct: Math.round((lowestRole[1].done / lowestRole[1].total) * 100),
          })}
        </p>
      )}
    </section>
  );
}

// B-23: the most urgent first — earliest due date across every hire — and "urgent" means the due day
// has passed (riskScore is never computed, so it cannot drive urgency).
export function PendingTasks({ plans }: { plans: OnboardingPlan[] }) {
  const { t, locale } = useI18n();
  const ownerLabel = useOwnerLabel();
  const incompleteTasks = sortByDueDate(
    plans.flatMap((p) =>
      p.tasks
        .filter((task) => !task.completed)
        .map((task) => ({
          id: task.id,
          name: task.title,
          responsible: task.responsible,
          person: `${p.user.firstName} ${p.user.lastName}`,
          dueDate: task.dueDate ?? null,
          urgent: isTaskOverdue(task),
        })),
    ),
  ).slice(0, 5);

  const totalPending = plans.reduce((s, p) => s + p.tasks.filter((t) => !t.completed).length, 0);

  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-subheading font-semibold text-primary">{t.onboarding.pendingTasks}</h2>
        <span className="min-w-6 rounded-full bg-surface px-2 py-0.5 text-center text-callout font-semibold tabular-nums text-secondary">
          {totalPending}
        </span>
      </div>
      <ul className="space-y-2">
        {incompleteTasks.length === 0 && <li className="text-callout text-secondary">{t.onboarding.noPendingTasks}</li>}
        {incompleteTasks.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <DocIcon urgent={task.urgent} />
              <div className="min-w-0">
                <p className="text-body font-medium text-primary">{task.name}</p>
                <p className="text-callout text-secondary">
                  {task.person} — {ownerLabel(task.responsible)}
                  {task.dueDate && ` · ${formatMessage(t.onboarding.taskDueOn, { date: formatDueDate(task.dueDate, locale) })}`}
                </p>
              </div>
            </div>
            {task.urgent && <StatusBadge tone="danger">{t.onboarding.taskOverdue}</StatusBadge>}
          </li>
        ))}
        {totalPending > 5 && (
          <li className="text-callout text-secondary">
            {formatMessage(t.onboarding.morePendingTasks, { count: totalPending - 5 })}
          </li>
        )}
      </ul>
    </section>
  );
}
