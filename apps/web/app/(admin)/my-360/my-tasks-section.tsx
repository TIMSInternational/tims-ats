'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { Skeleton, ErrorState, EmptyState } from '../../../components';
import { RaterTaskCard } from './rater-task-card';

/** "My Rater Tasks" zone: every pending assignment where the caller is the
 * rater (evaluation360.myRaterTasks), one RaterTaskCard per assignment. */
export function MyTasksSection() {
  const { t } = useI18n();
  const tasks = trpc.evaluation360.myRaterTasks.useQuery();

  return (
    <section>
      <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.my360.tasksTitle}</h2>

      {tasks.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : tasks.isError ? (
        <ErrorState onRetry={() => tasks.refetch()} />
      ) : (tasks.data ?? []).length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-8 h-8 text-[#B8B8B8]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          message={t.my360.tasksEmpty}
          description={t.my360.tasksEmptyDescription}
        />
      ) : (
        <div className="space-y-4">
          {(tasks.data ?? []).map((task) => (
            <RaterTaskCard key={task.assignmentId} task={task} />
          ))}
        </div>
      )}
    </section>
  );
}
