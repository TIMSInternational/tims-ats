'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, StatusBadge } from '../../../components';
import { Button } from '../../../components/button';
import { ProgressBar } from '../../../components/progress-bar';
import { formatDueDate, isTaskOverdue, nextOpenTasks } from '../../../lib/onboarding-schedule';
import { LoadError } from './load-error';
import { ListSkeletonRows } from './employee-dashboard-ui';

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

  if (onboarding.isError) return <LoadError message={e.loadError} onRetry={() => onboarding.refetch()} />;
  if (onboarding.isLoading) return <ListSkeletonRows />;
  if (!plan) {
    // Still offer the page: an employee who is someone's buddy finds "Personas que acompañas" there.
    return (
      <div className="space-y-3">
        <EmptyState size="compact" message={e.noOnboarding} />
        <Button href="/my-onboarding" variant="secondary" size="sm">
          {e.openOnboarding}
        </Button>
      </div>
    );
  }

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
      {/* The bar takes its own full-width line under the title, so the title never squeezes on phones. */}
      <div>
        <ProgressBar value={progress} label={e.onboardingProgress} valueText={`${progress}%`} />
        <p className="mt-1 text-callout text-secondary">{e.onboardingStart.replace('{date}', startDate)}</p>
      </div>
      <div>
        <h3 className="mb-1.5 text-callout font-semibold text-brand">{e.nextTasks}</h3>
        {nextTasks.length === 0 ? (
          <p className="text-callout text-secondary">{e.noOpenTasks}</p>
        ) : (
          <ul className="divide-y divide-border">
            {nextTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-callout">
                <span className="text-primary">{task.title}</span>
                <span className="flex items-center gap-1.5 text-muted">
                  {task.dueDate && e.taskDue.replace('{date}', formatDueDate(task.dueDate, locale))}
                  {isTaskOverdue(task) && <StatusBadge tone="danger">{e.taskOverdue}</StatusBadge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button href="/my-onboarding" size="sm">
        {e.openOnboarding}
      </Button>
    </div>
  );
}
