'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';
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

  const daysAgo = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  };

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[#1F114C]">
          {showAssessments ? rd.pendingTests : rd.pendingScorecards}
        </span>
        <span className="bg-amber-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
          {totalPending}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
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
              <p className="text-xs text-[#585858] mb-2">
                {rd.pendingTestsLabel} ({tests.length})
              </p>
              <div className="space-y-2 mb-3">
                {tests.slice(0, 3).map((test) => (
                  <div key={test.id} className="flex justify-between items-center h-10">
                    <div>
                      <p className="text-[13px] text-[#333]">
                        {test.candidate.firstName} {test.candidate.lastName} — {test.assessmentType.name}
                      </p>
                      <p className="text-[11px] text-[#8B8B8B]">
                        {rd.assignedAgo} {daysAgo(test.assignedAt)} {rd.days}
                      </p>
                    </div>
                  </div>
                ))}
                {tests.length > 3 && (
                  <span className="text-xs text-[#DD0C15]">
                    +{tests.length - 3} {rd.more}
                  </span>
                )}
                {tests.length === 0 && <p className="text-[11px] text-[#8B8B8B]">{rd.noPendingTests}</p>}
              </div>
            </>
          )}

          {/* Pending Scorecards */}
          <div className={showAssessments ? 'border-t border-[#EDEDED] pt-3' : ''}>
            <p className="text-xs text-[#585858] mb-2">
              {rd.pendingScorecards} ({scorecards.length})
            </p>
            <div className="space-y-2">
              {scorecards.slice(0, 2).map((sc) => (
                <Link key={sc.interview.id} href={`/recruitment/interviews/${sc.interview.id}/room`} aria-label={rd.openInterviewRoom.replace('{name}', () => `${sc.interview.candidate.firstName} ${sc.interview.candidate.lastName}`)} className="flex justify-between items-center h-10 rounded-lg -mx-1 px-1 hover:bg-[#F6F6F6] transition">
                  <div>
                    <p className="text-[13px] text-[#333]">
                      {sc.interview.candidate.firstName} {sc.interview.candidate.lastName} —{' '}
                      {sc.interview.vacancy.title}
                    </p>
                    {/* When it took place — not the raw panel role slug (B-29). */}
                    <p className="text-[11px] text-[#8B8B8B]">{formatInterviewWhen(sc.interview.scheduledAt, locale)}</p>
                  </div>
                </Link>
              ))}
              {scorecards.length > 2 && (
                <span className="text-xs text-[#DD0C15]">
                  +{scorecards.length - 2} {rd.more}
                </span>
              )}
              {scorecards.length === 0 && <p className="text-[11px] text-[#8B8B8B]">{rd.noPendingScorecards}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
