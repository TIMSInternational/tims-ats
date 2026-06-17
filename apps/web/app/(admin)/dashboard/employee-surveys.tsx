'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// "Mis Encuestas" — OWN-scoped pending surveys (active surveys the caller has not
// yet answered). No employee-reachable survey-take route exists, so each row is
// listed (title + close date) without a take link, per the slice scope.
export function EmployeeSurveys() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const surveys = trpc.engagement.myPendingSurveys.useQuery();
  const list = surveys.data ?? [];

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-8">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{e.surveys}</h2>
      {surveys.isError ? (
        <LoadError message={e.loadError} />
      ) : surveys.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={e.noSurveys} />
      ) : (
        <div className="space-y-1">
          {list.map((survey) => (
            <div
              key={survey.id}
              className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3"
            >
              <span className="text-sm text-[#333] font-medium truncate">
                {survey.title}
              </span>
              <span className="text-[13px] text-[#8B8B8B] ml-3 shrink-0">
                {survey.endsAt
                  ? `${e.surveyCloses} ${formatDate(survey.endsAt)}`
                  : e.surveyNoClose}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
