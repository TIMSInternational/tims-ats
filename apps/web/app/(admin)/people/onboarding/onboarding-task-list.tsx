'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

interface OnboardingTaskItem {
  id: string;
  title: string;
  completed: boolean;
}

interface OnboardingTaskListProps {
  tasks: OnboardingTaskItem[];
}

export function OnboardingTaskList({ tasks }: OnboardingTaskListProps) {
  const { t } = useI18n();
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
      {tasks.map((task) => (
        <tr key={task.id} className="bg-[#F9F9FB] border-b border-[#F0F0F0]">
          <td colSpan={9} className="py-1.5 px-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={task.completed}
                onChange={(e) =>
                  toggleTask.mutate({ id: task.id, completed: e.target.checked })
                }
                disabled={toggleTask.isPending}
                className="h-3.5 w-3.5 rounded border-[#EDEDED] text-[#DD0C15] focus:ring-[#1F114C]/40 disabled:opacity-50"
              />
              <span
                className={`text-[11px] ${
                  task.completed ? 'line-through text-[#8B8B8B]' : 'text-[#333]'
                }`}
              >
                {task.title}
              </span>
            </label>
          </td>
        </tr>
      ))}
    </>
  );
}
