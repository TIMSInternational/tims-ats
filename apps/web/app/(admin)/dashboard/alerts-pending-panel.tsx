'use client';

import { useId } from 'react';
import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';
import { StatusBadge } from '../../../components/status-badge';
import { isPilotScope } from '../../../lib/launch-scope';
import { formatInterviewWhen } from '../recruitment/interviews/interview-status';

export function AlertsPendingPanel() {
  const { t, locale } = useI18n();
  const rd = t.recruitingDashboard;

  // Assessments are out of the pilot launch scope: the query is disabled (not just hidden), and a failure of
  // it can no longer hide the pending scorecards.
  const showAssessments = !isPilotScope();
  const pendingAssessments = trpc.assessment.listPending.useQuery({ limit: 10 }, { enabled: showAssessments });
  const pendingScorecards = trpc.interview.getPendingScorecards.useQuery();

  const tests = showAssessments ? (pendingAssessments.data?.items ?? []) : [];
  const scorecards = pendingScorecards.data ?? [];
  const isLoading = (showAssessments && pendingAssessments.isLoading) || pendingScorecards.isLoading;
  const isError = (showAssessments && pendingAssessments.isError) || pendingScorecards.isError;

  const totalPending = tests.length + scorecards.length;
  const titleId = useId();

  const daysAgo = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  };

  return (
    <section aria-labelledby={titleId} className="w-full rounded-xl bg-white p-4 shadow-card md:flex-1">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-subheading font-semibold text-brand">
          {showAssessments ? rd.pendingTests : rd.pendingScorecards}
        </h3>
        <StatusBadge tone={totalPending > 0 ? 'warning' : 'neutral'} icon="none" className="tabular-nums">
          {totalPending}
        </StatusBadge>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-10 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          size="compact"
          onRetry={() => {
            if (showAssessments) pendingAssessments.refetch();
            pendingScorecards.refetch();
          }}
        />
      ) : (
        <>
          {showAssessments && (
            <>
              {/* Pending Assessments */}
              <h4 className="mb-2 text-callout font-medium text-secondary">
                {rd.pendingTestsLabel} ({tests.length})
              </h4>
              <ul className="mb-3 space-y-2">
                {tests.slice(0, 3).map((test) => (
                  <li key={test.id} className="flex min-h-10 items-center justify-between">
                    <div>
                      <p className="text-body text-primary">
                        {test.candidate.firstName} {test.candidate.lastName} — {test.assessmentType.name}
                      </p>
                      <p className="text-caption text-muted">
                        {rd.assignedAgo} {daysAgo(test.assignedAt)} {rd.days}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {/* A count of the rest, not a link. */}
              {tests.length > 3 && (
                <p className="mb-3 text-callout text-secondary">
                  +{tests.length - 3} {rd.more}
                </p>
              )}
              {tests.length === 0 && <p className="mb-3 text-callout text-muted">{rd.noPendingTests}</p>}
            </>
          )}

          {/* Pending Scorecards */}
          <div className={showAssessments ? 'border-t border-border pt-3' : ''}>
            <h4 className="mb-2 text-callout font-medium text-secondary">
              {rd.pendingScorecards} ({scorecards.length})
            </h4>
            <ul className="space-y-2">
              {scorecards.slice(0, 2).map((sc) => (
                <li key={sc.interview.id}>
                  <Link
                    href={`/recruitment/interviews/${sc.interview.id}/room`}
                    aria-label={rd.openInterviewRoom.replace(
                      '{name}',
                      () => `${sc.interview.candidate.firstName} ${sc.interview.candidate.lastName}`,
                    )}
                    className="-mx-1 flex min-h-10 items-center justify-between rounded-lg px-1 transition-colors hover:bg-surface pointer-coarse:min-h-11"
                  >
                    <div>
                      <p className="text-body text-primary">
                        {sc.interview.candidate.firstName} {sc.interview.candidate.lastName} —{' '}
                        {sc.interview.vacancy.title}
                      </p>
                      {/* When it took place — not the raw panel role slug (B-29). */}
                      <p className="text-caption text-muted">{formatInterviewWhen(sc.interview.scheduledAt, locale)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {scorecards.length > 2 && (
              <p className="mt-2 text-callout text-secondary">
                +{scorecards.length - 2} {rd.more}
              </p>
            )}
            {scorecards.length === 0 && <p className="text-callout text-muted">{rd.noPendingScorecards}</p>}
          </div>
        </>
      )}
    </section>
  );
}
