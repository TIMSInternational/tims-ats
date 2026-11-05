'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { formatDueDate, isTaskOverdue, sortByDueDate } from '../../../../lib/onboarding-schedule';

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
}

// B-23: HR sees each task's due day and a red "Vencida" once it has passed, earliest due first.
export function OnboardingTaskList({ tasks, canToggle = true }: OnboardingTaskListProps) {
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
      <tr>
        <td colSpan={9} className="pb-2 px-4">
          <span className="text-[11px] text-[#8B8B8B]">{t.onboarding.noTasksRegistered}</span>
        </td>
      </tr>
    );
  }

  return (
    <>
      {sortByDueDate(tasks).map((task) => {
        const overdue = isTaskOverdue(task);
        return (
          <tr key={task.id} className="bg-[#F9F9FB] border-b border-[#F0F0F0]">
            <td colSpan={9} className="py-1.5 px-6">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={(e) => toggleTask.mutate({ id: task.id, completed: e.target.checked })}
                    disabled={!canToggle || toggleTask.isPending}
                    aria-label={task.title}
                    className="h-3.5 w-3.5 rounded border-[#EDEDED] text-[#DD0C15] focus:ring-[#1F114C]/40 disabled:opacity-50"
                  />
                  <span className={`text-[11px] ${task.completed ? 'line-through text-[#8B8B8B]' : 'text-[#333]'}`}>
                    {task.title}
                  </span>
                </label>
                {task.dueDate && (
                  <span className="text-[10px] text-[#8B8B8B]">
                    {t.onboarding.taskDueOn.replace('{date}', formatDueDate(task.dueDate, locale))}
                  </span>
                )}
                {overdue && (
                  <span className="rounded bg-[#DD0C15]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#DD0C15]">
                    {t.onboarding.taskOverdue}
                  </span>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
