'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState } from '../../../components';
import { formatDueDate, isTaskOverdue, nextOpenTasks } from '../../../lib/onboarding-schedule';
import { LoadError } from './load-error';
import { EMPTY_ICON, ListSkeletonRows, ProgressBar } from './employee-dashboard-ui';

/** How many open tasks the home card previews; the full list is on /my-onboarding. */
const NEXT_TASKS_SHOWN = 3;

/**
 * B-25: the employee's home card. `mine: true` — without it the own-scoped list also returns plans where
 * the caller is someone's BUDDY, and that person's progress showed up as the caller's own. The card shows
 * the start date, progress, the next open tasks with their due dates, and a link to "Mi Onboarding".
 */
export function EmployeeOnboardingCard() {
  const { t, locale } = useI18n();
  const e = t.employeeHome;
  const onboarding = trpc.onboarding.list.useQuery({ limit: 1, status: 'active', mine: true });
  const plan = onboarding.data?.plans[0];

  if (onboarding.isError) return <LoadError message={e.loadError} />;
  if (onboarding.isLoading) return <ListSkeletonRows />;
  if (!plan) return <EmptyState icon={EMPTY_ICON} message={e.noOnboarding} />;

  const tasks = plan.tasks ?? [];
  const progress =
    tasks.length === 0 ? 0 : Math.round((tasks.filter((task) => task.completed).length / tasks.length) * 100);
  const nextTasks = nextOpenTasks(tasks, NEXT_TASKS_SHOWN);
  const startDate = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es-CR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(plan.startDate));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-[#333] font-medium">{e.onboardingProgress}</span>
          <p className="text-[12px] text-[#8B8B8B]">{e.onboardingStart.replace('{date}', startDate)}</p>
        </div>
        <ProgressBar value={progress} />
      </div>
      <div>
        <p className="text-[12px] font-semibold text-[#1F114C] mb-1.5">{e.nextTasks}</p>
        {nextTasks.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{e.noOpenTasks}</p>
        ) : (
          <ul className="divide-y divide-[#F0F0F0]">
            {nextTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[12px]">
                <span className="text-[#333]">{task.title}</span>
                <span className="flex items-center gap-1.5 text-[#8B8B8B]">
                  {task.dueDate && e.taskDue.replace('{date}', formatDueDate(task.dueDate, locale))}
                  {isTaskOverdue(task) && (
                    <span className="rounded bg-[#DD0C15]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#DD0C15]">
                      {e.taskOverdue}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link
        href="/my-onboarding"
        className="inline-flex items-center h-8 px-3 rounded-lg bg-[#1F114C] text-white text-[12px] font-medium hover:bg-[#2d1a6b] transition"
      >
        {e.openOnboarding}
      </Link>
    </div>
  );
}
