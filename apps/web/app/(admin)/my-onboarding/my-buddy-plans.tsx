'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { BUDDY_TASK_OWNER } from '../../../lib/onboarding-labels';
import { formatDueDate, isTaskOverdue, sortByDueDate } from '../../../lib/onboarding-schedule';
import { intlLocale } from '../../../lib/format-utils';
import { CHOICE_INPUT_CLASSES, ErrorState, StatusBadge } from '../../../components';

/** Plans one person accompanies at once; more than this is not a realistic buddy load. */
const BUDDY_PLAN_LIMIT = 20;

/**
 * B-08 follow-up: a buddy who is an employee only has "Mi Onboarding". This section lists the hires the
 * caller accompanies (onboarding.list asBuddy) and lets them tick the buddy-owned tasks — the only tasks
 * the server lets a buddy complete (onboarding-self-service.ts). Renders nothing when there are none.
 */
export function MyBuddyPlans() {
  const { t, locale } = useI18n();
  const m = t.myOnboarding;
  const utils = trpc.useUtils();
  const plans = trpc.onboarding.list.useQuery({ limit: BUDDY_PLAN_LIMIT, status: 'active', asBuddy: true });
  const toggle = trpc.onboarding.updateTask.useMutation({
    onSuccess: () => {
      void utils.onboarding.list.invalidate();
      void utils.onboarding.getById.invalidate();
      toast(m.taskUpdated, { type: 'success' });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  if (plans.isError) {
    return (
      <section className="rounded-xl border border-border bg-white shadow-card">
        <ErrorState size="compact" title={m.buddyLoadError} error={plans.error} onRetry={() => void plans.refetch()} />
      </section>
    );
  }
  const buddyPlans = plans.data?.plans ?? [];
  if (plans.isLoading || buddyPlans.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5">
      <h2 className="text-subheading font-semibold text-primary">{m.buddyPlansTitle}</h2>
      <p className="mt-1 text-callout text-secondary">{m.buddyPlansDesc}</p>
      <ul className="mt-3 space-y-4">
        {buddyPlans.map((plan) => {
          const tasks = sortByDueDate(plan.tasks.filter((task) => task.responsible === BUDDY_TASK_OWNER));
          const name = `${plan.user.firstName} ${plan.user.lastName}`;
          return (
            <li key={plan.id} className="rounded-lg border border-border p-3">
              <p className="text-body font-medium text-primary">{name}</p>
              <p className="text-callout text-secondary">
                {m.startDate}:{' '}
                {new Intl.DateTimeFormat(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' }).format(
                  new Date(plan.startDate),
                )}
              </p>
              {tasks.length === 0 ? (
                <p className="mt-2 text-callout text-secondary">{m.noBuddyTasks}</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        disabled={toggle.isPending}
                        onChange={(event) => toggle.mutate({ id: task.id, completed: event.target.checked })}
                        aria-label={`${task.title} — ${name}`}
                        className={`size-5! ${CHOICE_INPUT_CLASSES}`}
                      />
                      <span className={`text-body ${task.completed ? 'text-secondary line-through' : 'text-primary'}`}>
                        {task.title}
                      </span>
                      {task.dueDate && (
                        <span className="text-callout tabular-nums text-secondary">
                          {m.dueDate}: {formatDueDate(task.dueDate, locale)}
                        </span>
                      )}
                      {isTaskOverdue(task) && <StatusBadge tone="danger">{m.overdue}</StatusBadge>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
