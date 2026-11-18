'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { formatDueDate, isTaskOverdue, sortByDueDate } from '../../../../lib/onboarding-schedule';
import { CHOICE_INPUT_CLASSES, StatusBadge } from '../../../../components';

interface OnboardingTaskItem {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: Date | string | null;
}

interface OnboardingTaskListProps {
  tasks: OnboardingTaskItem[];
  /** onboarding:update. Without it the checklist is read-only (the API would refuse the toggle). */
  canToggle?: boolean;
  /** Id of the first row, the target of the "Ver tareas" button's aria-controls. */
  firstRowId?: string;
}

const ROW = 'border-b border-border bg-surface-hover max-md:block';

// B-23: HR sees each task's due day and a "Vencida" chip once it has passed, earliest due first.
// The whole row is the checkbox's label, so the hit region is the row (min 28px, 44px on touch).
export function OnboardingTaskList({ tasks, canToggle = true, firstRowId }: OnboardingTaskListProps) {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();

  const toggleTask = trpc.onboarding.updateTask.useMutation({
    onSuccess: () => {
      utils.onboarding.list.invalidate();
      utils.onboarding.getDashboardKpis.invalidate();
      toast(t.onboarding.taskToggleSuccess, { type: 'success' });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  if (tasks.length === 0) {
    return (
      <tr id={firstRowId} className={ROW}>
        <td colSpan={9} className="px-4 py-2 md:px-6">
          <span className="text-callout text-secondary">{t.onboarding.noTasksRegistered}</span>
        </td>
      </tr>
    );
  }

  return (
    <>
      {sortByDueDate(tasks).map((task, index) => {
        const overdue = isTaskOverdue(task);
        return (
          <tr key={task.id} id={index === 0 ? firstRowId : undefined} className={ROW}>
            <td colSpan={9} className="px-4 py-1 md:px-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex min-h-7 flex-1 cursor-pointer items-center gap-2 pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={(e) => toggleTask.mutate({ id: task.id, completed: e.target.checked })}
                    disabled={!canToggle || toggleTask.isPending}
                    aria-label={task.title}
                    className={CHOICE_INPUT_CLASSES}
                  />
                  <span className={`text-body ${task.completed ? 'text-secondary line-through' : 'text-primary'}`}>
                    {task.title}
                  </span>
                </label>
                {task.dueDate && (
                  <span className="text-callout tabular-nums text-secondary">
                    {formatMessage(t.onboarding.taskDueOn, { date: formatDueDate(task.dueDate, locale) })}
                  </span>
                )}
                {overdue && <StatusBadge tone="danger">{t.onboarding.taskOverdue}</StatusBadge>}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
