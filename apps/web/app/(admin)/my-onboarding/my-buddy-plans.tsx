'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { BUDDY_TASK_OWNER } from '../../../lib/onboarding-labels';
import { formatDueDate, isTaskOverdue, sortByDueDate } from '../../../lib/onboarding-schedule';

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
    return <p className="rounded-xl border border-red-100 bg-red-50 p-4 text-[13px] text-red-700">{m.loadError}</p>;
  }
  const buddyPlans = plans.data?.plans ?? [];
  if (plans.isLoading || buddyPlans.length === 0) return null;

  return (
    <section className="rounded-xl border border-[#EDEDED] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#1F114C]">{m.buddyPlansTitle}</h2>
      <p className="mt-1 text-[12px] text-[#585858]">{m.buddyPlansDesc}</p>
      <ul className="mt-3 space-y-4">
        {buddyPlans.map((plan) => {
          const tasks = sortByDueDate(plan.tasks.filter((task) => task.responsible === BUDDY_TASK_OWNER));
          const name = `${plan.user.firstName} ${plan.user.lastName}`;
          return (
            <li key={plan.id} className="rounded-lg border border-[#F0F0F0] p-3">
              <p className="text-[13px] font-medium text-[#333]">{name}</p>
              <p className="text-[11px] text-[#8B8B8B]">
                {m.startDate}: {new Date(plan.startDate).toLocaleDateString(locale === 'EN' ? 'en' : 'es-CR')}
              </p>
              {tasks.length === 0 ? (
                <p className="mt-2 text-[12px] text-[#8B8B8B]">{m.noBuddyTasks}</p>
              ) : (
                <ul className="mt-2 divide-y divide-[#F0F0F0]">
                  {tasks.map((task) => (
                    <li key={task.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        disabled={toggle.isPending}
                        onChange={(event) => toggle.mutate({ id: task.id, completed: event.target.checked })}
                        aria-label={`${task.title} — ${name}`}
                        className="h-4 w-4 rounded border-[#EDEDED] text-[#DD0C15] focus:ring-[#1F114C]/40 disabled:opacity-50"
                      />
                      <span className={`text-[13px] ${task.completed ? 'line-through text-[#8B8B8B]' : 'text-[#333]'}`}>
                        {task.title}
                      </span>
                      {task.dueDate && (
                        <span className="text-[11px] text-[#8B8B8B]">
                          {m.dueDate}: {formatDueDate(task.dueDate, locale)}
                        </span>
                      )}
                      {isTaskOverdue(task) && (
                        <span className="rounded bg-[#DD0C15]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#DD0C15]">
                          {m.overdue}
                        </span>
                      )}
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
