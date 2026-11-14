'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { intlLocale } from '../../../lib/format-utils';
import { NEW_HIRE_TASK_OWNER, onboardingOwnerLabel } from '../../../lib/onboarding-labels';
import { isTaskOverdue, sortByDueDate } from '../../../lib/onboarding-schedule';
import { CHOICE_INPUT_CLASSES, StatusBadge } from '../../../components';

interface MyTaskItem {
  id: string;
  title: string;
  responsible: string;
  description?: string | null;
  dueDate: Date | string | null;
  completed: boolean;
}

interface MyTaskListProps {
  tasks: MyTaskItem[];
}

const CARD = 'rounded-xl border border-border bg-white p-4 shadow-card md:p-5';

// The hire can only toggle the tasks they own (responsible = "employee"). Those come first, each row a
// full-width label around a real checkbox. HR, IT, manager and buddy tasks follow as a read-only list with
// a status chip instead of a disabled checkbox, so the hire sees the whole checklist without marking
// someone else's work done. B-24: earliest due first within each group, a "Vencida" chip once the due day
// has passed, and the task's description (what it means and what to do) under the title.
export function MyTaskList({ tasks }: MyTaskListProps) {
  const { t, locale } = useI18n();
  const m = t.myOnboarding;
  const dateFormat = new Intl.DateTimeFormat(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });
  const utils = trpc.useUtils();

  const toggleTask = trpc.onboarding.updateTask.useMutation({
    onSuccess: () => {
      void utils.onboarding.getById.invalidate();
      void utils.onboarding.list.invalidate();
      toast(m.taskUpdated, { type: 'success' });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const sorted = sortByDueDate(tasks);
  const mine = sorted.filter((task) => task.responsible === NEW_HIRE_TASK_OWNER);
  const others = sorted.filter((task) => task.responsible !== NEW_HIRE_TASK_OWNER);

  const meta = (task: MyTaskItem) => (
    <p className="mt-0.5 text-callout text-secondary">
      {m.owner}: {onboardingOwnerLabel(m.labels, task.responsible)} · {m.dueDate}:{' '}
      <span className="tabular-nums">{task.dueDate ? dateFormat.format(new Date(task.dueDate)) : m.noDueDate}</span>
    </p>
  );
  const body = (task: MyTaskItem) => (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className={`text-body ${task.completed ? 'text-secondary line-through' : 'text-primary'}`}>{task.title}</span>
        {isTaskOverdue(task) && <StatusBadge tone="danger">{m.overdue}</StatusBadge>}
      </span>
      {task.description?.trim() && (
        <span className="mt-0.5 block whitespace-pre-line text-callout text-secondary">{task.description}</span>
      )}
      {meta(task)}
    </>
  );

  return (
    <section className={CARD} aria-labelledby="my-tasks-heading">
      <h2 id="my-tasks-heading" className="text-subheading font-semibold text-primary">
        {m.tasksTitle}
      </h2>
      {tasks.length === 0 ? (
        <p className="mt-3 text-body text-secondary">{m.noTasks}</p>
      ) : (
        <>
          {mine.length > 0 && (
            <>
              <h3 className="mt-3 text-callout font-semibold text-secondary">{m.yourTasks}</h3>
              <ul className="mt-1 divide-y divide-border">
                {mine.map((task) => (
                  <li key={task.id}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        disabled={toggleTask.isPending}
                        onChange={(event) => toggleTask.mutate({ id: task.id, completed: event.target.checked })}
                        aria-label={task.title}
                        className={`mt-0.5 size-5! ${CHOICE_INPUT_CLASSES}`}
                      />
                      <span className="min-w-0 flex-1">{body(task)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <h3 className="mt-4 text-callout font-semibold text-secondary">{m.othersTasks}</h3>
              <ul className="mt-1 divide-y divide-border">
                {others.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 py-2.5">
                    <StatusBadge tone={task.completed ? 'success' : 'neutral'} className="mt-0.5 shrink-0">
                      {task.completed ? m.taskDone : m.labels.statuses.pending}
                    </StatusBadge>
                    <div className="min-w-0 flex-1">{body(task)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
