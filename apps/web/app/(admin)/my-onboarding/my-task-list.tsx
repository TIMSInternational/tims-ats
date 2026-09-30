'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { NEW_HIRE_TASK_OWNER, onboardingOwnerLabel } from '../../../lib/onboarding-labels';

interface MyTaskItem {
  id: string;
  title: string;
  responsible: string;
  dueDate: Date | string | null;
  completed: boolean;
}

interface MyTaskListProps {
  tasks: MyTaskItem[];
}

// The hire can only toggle the tasks they own (responsible = "employee"); HR,
// IT, manager and buddy tasks are shown read-only so the hire sees the whole
// checklist without marking someone else's work done.
export function MyTaskList({ tasks }: MyTaskListProps) {
  const { t, locale } = useI18n();
  const m = t.myOnboarding;
  const dateLocale = locale === 'EN' ? 'en' : 'es';
  const utils = trpc.useUtils();

  const toggleTask = trpc.onboarding.updateTask.useMutation({
    onSuccess: () => {
      void utils.onboarding.getById.invalidate();
      void utils.onboarding.list.invalidate();
      toast(m.taskUpdated, { type: 'success' });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  return (
    <section className="rounded-xl border border-[#EDEDED] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#1F114C]">{m.tasksTitle}</h2>
      {tasks.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#8B8B8B]">{m.noTasks}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#F0F0F0]">
          {tasks.map((task) => {
            const isMine = task.responsible === NEW_HIRE_TASK_OWNER;
            return (
              <li key={task.id} className="flex items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={task.completed}
                  disabled={!isMine || toggleTask.isPending}
                  onChange={(event) => toggleTask.mutate({ id: task.id, completed: event.target.checked })}
                  aria-label={task.title}
                  title={isMine ? undefined : m.ownedByOthers}
                  className="mt-0.5 h-4 w-4 rounded border-[#EDEDED] text-[#DD0C15] focus:ring-[#1F114C]/40 disabled:opacity-50"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[13px] ${task.completed ? 'line-through text-[#8B8B8B]' : 'text-[#333]'}`}>
                    {task.title}
                  </p>
                  <p className="text-[11px] text-[#8B8B8B]">
                    {m.owner}: {onboardingOwnerLabel(m.labels, task.responsible)} · {m.dueDate}:{' '}
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString(dateLocale) : m.noDueDate}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
