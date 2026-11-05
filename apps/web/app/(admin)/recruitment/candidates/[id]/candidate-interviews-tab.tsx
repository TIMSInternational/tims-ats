'use client';

import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { ErrorState, Skeleton, StatusBadge } from '../../../../../components';
import { displayInterviewStatus, formatInterviewWhen } from '../../interviews/interview-status';
import { interviewTypeLabel } from '../../interviews/[id]/room/interview-type-label';

const STATUS_CLASSES: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-600 border border-blue-200',
  in_progress: 'bg-amber-50 text-amber-600 border border-amber-200',
  awaiting_scorecard: 'bg-amber-50 text-amber-700 border border-amber-200',
  completed: 'bg-green-50 text-green-600 border border-green-200',
  cancelled: 'bg-gray-100 text-gray-600',
  no_show: 'bg-red-50 text-red-600 border border-red-200',
  rescheduled: 'bg-violet-50 text-violet-600 border border-violet-200',
};

/**
 * The candidate's interviews, newest first (A-15 / journeys-27): when, what kind, status (same honest status
 * as the interviews list), the panel and how many scorecards are in, with a link to the room.
 */
export function CandidateInterviewsTab({ candidateId, onSchedule }: { candidateId: string; onSchedule?: () => void }) {
  const { t, locale } = useI18n();
  const interviews = trpc.interview.list.useQuery({ candidateId, sort: 'desc', pageSize: 50 }, { refetchOnMount: 'always' });
  const statusMap: Record<string, { cls: string; label: string }> = {
    scheduled: { cls: STATUS_CLASSES.scheduled!, label: t.interviews.statusScheduled },
    in_progress: { cls: STATUS_CLASSES.in_progress!, label: t.interviews.statusInProgress },
    awaiting_scorecard: { cls: STATUS_CLASSES.awaiting_scorecard!, label: t.interviews.statusAwaitingScorecard },
    completed: { cls: STATUS_CLASSES.completed!, label: t.interviews.statusCompleted },
    cancelled: { cls: STATUS_CLASSES.cancelled!, label: t.interviews.statusCancelled },
    no_show: { cls: STATUS_CLASSES.no_show!, label: t.interviews.statusNoShow },
    rescheduled: { cls: STATUS_CLASSES.rescheduled!, label: t.interviews.statusRescheduled },
  };
  const items = interviews.data?.items ?? [];
  const now = new Date();

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.candidates.tabInterviews}</h3>
        {onSchedule && (
          <button
            type="button"
            onClick={onSchedule}
            className="rounded-lg bg-[#1F114C] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#2a1a5c]"
          >
            {t.candidates.scheduleInterview}
          </button>
        )}
      </div>
      {interviews.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : interviews.isError ? (
        <ErrorState message={t.candidates.interviewsLoadError} error={interviews.error} onRetry={() => interviews.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] py-4 text-center">{t.candidates.interviewsEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((iv) => {
            const submitted = iv._count?.scorecards ?? 0;
            const evaluators = iv.evaluators.map((e) => `${e.user.firstName} ${e.user.lastName}`.trim()).join(', ');
            return (
              <li key={iv.id} className="flex flex-col gap-2 rounded-lg bg-[#F6F6F6] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#333] truncate">{iv.vacancy.title}</p>
                  <p className="text-[11px] text-[#585858]">
                    {formatInterviewWhen(iv.scheduledAt, locale)} · {interviewTypeLabel(t, iv.type)}
                  </p>
                  {evaluators && (
                    <p className="text-[11px] text-[#8B8B8B] truncate">
                      {t.candidates.interviewsEvaluators.replace('{names}', evaluators)}
                    </p>
                  )}
                  <p className="text-[11px] text-[#8B8B8B]">
                    {t.candidates.interviewsScorecards
                      .replace('{submitted}', String(submitted))
                      .replace('{total}', String(iv.evaluators.length))}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={displayInterviewStatus(iv, now)} map={statusMap} />
                  <Link href={`/recruitment/interviews/${iv.id}/room`} className="text-[12px] font-medium text-[#DD0C15] hover:underline">
                    {t.candidates.interviewsOpenRoom}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
