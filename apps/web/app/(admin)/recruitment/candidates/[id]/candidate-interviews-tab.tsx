'use client';

import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  TEXT_LINK_CLASSES,
  type StatusMapEntry,
} from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';
import { displayInterviewStatus, formatInterviewWhen } from '../../interviews/interview-status';
import { interviewTypeLabel } from '../../interviews/[id]/room/interview-type-label';

/**
 * The candidate's interviews, newest first (A-15 / journeys-27): when, what kind, status (same honest status
 * as the interviews list), the panel and how many scorecards are in, with a link to the room.
 */
export function CandidateInterviewsTab({ candidateId, onSchedule }: { candidateId: string; onSchedule?: () => void }) {
  const { t, locale } = useI18n();
  const interviews = trpc.interview.list.useQuery(
    { candidateId, sort: 'desc', pageSize: 50 },
    { refetchOnMount: 'always' },
  );
  // Status tones (foundation-spec.md §12): a word plus an icon for outcomes, never colour alone.
  const statusMap: Record<string, StatusMapEntry> = {
    scheduled: { tone: 'info', label: t.interviews.statusScheduled },
    in_progress: { tone: 'warning', label: t.interviews.statusInProgress },
    awaiting_scorecard: { tone: 'warning', label: t.interviews.statusAwaitingScorecard },
    completed: { tone: 'success', label: t.interviews.statusCompleted },
    cancelled: { tone: 'neutral', label: t.interviews.statusCancelled },
    no_show: { tone: 'danger', label: t.interviews.statusNoShow },
    rescheduled: { tone: 'info', label: t.interviews.statusRescheduled },
  };
  const items = interviews.data?.items ?? [];
  const now = new Date();

  return (
    <section className={CARD}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={`${CARD_TITLE} mb-0`}>{t.candidates.tabInterviews}</h2>
        {onSchedule && items.length > 0 && (
          <Button variant="secondary" size="sm" onClick={onSchedule}>
            {t.candidates.scheduleInterview}
          </Button>
        )}
      </div>
      {interviews.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : interviews.isError ? (
        <ErrorState
          size="compact"
          message={t.candidates.interviewsLoadError}
          error={interviews.error}
          onRetry={() => interviews.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          size="compact"
          title={t.candidates.interviewsEmpty}
          action={
            onSchedule
              ? { label: t.candidates.scheduleInterview, onClick: onSchedule, variant: 'secondary' }
              : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((iv) => {
            const submitted = iv._count?.scorecards ?? 0;
            const evaluators = iv.evaluators.map((e) => `${e.user.firstName} ${e.user.lastName}`.trim()).join(', ');
            return (
              <li
                key={iv.id}
                className="flex flex-col gap-2 rounded-lg bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-primary">{iv.vacancy.title}</p>
                  <p className="text-callout text-secondary">
                    {formatInterviewWhen(iv.scheduledAt, locale)} · {interviewTypeLabel(t, iv.type)}
                  </p>
                  {evaluators && (
                    <p className="truncate text-callout text-secondary">
                      {t.candidates.interviewsEvaluators.replace('{names}', evaluators)}
                    </p>
                  )}
                  <p className="text-callout text-secondary">
                    {t.candidates.interviewsScorecards
                      .replace('{submitted}', String(submitted))
                      .replace('{total}', String(iv.evaluators.length))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={displayInterviewStatus(iv, now)} map={statusMap} />
                  <Link href={`/recruitment/interviews/${iv.id}/room`} className={`${TEXT_LINK_CLASSES} text-callout`}>
                    {t.candidates.interviewsOpenRoom}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
