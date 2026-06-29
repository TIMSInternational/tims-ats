'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';

export function AlertsPendingPanel() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  const pendingAssessments = trpc.assessment.listPending.useQuery({ limit: 10 });
  const pendingScorecards = trpc.interview.getPendingScorecards.useQuery();

  const tests = pendingAssessments.data?.items ?? [];
  const scorecards = pendingScorecards.data ?? [];
  const isLoading = pendingAssessments.isLoading || pendingScorecards.isLoading;

  const totalPending = tests.length + scorecards.length;

  const daysAgo = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  };

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[#1F114C]">{rd.pendingTests}</span>
        <span className="bg-amber-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
          {totalPending}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
        </div>
      ) : (
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
                <button
                  onClick={() => toast(rd.resendComingSoon, { type: 'info' })}
                  className="text-xs text-[#DD0C15] hover:underline"
                >
                  {rd.resend}
                </button>
              </div>
            ))}
            {tests.length > 3 && (
              <span className="text-xs text-[#DD0C15]">+{tests.length - 3} {rd.more}</span>
            )}
            {tests.length === 0 && (
              <p className="text-[11px] text-[#8B8B8B]">{rd.noPendingTests}</p>
            )}
          </div>

          {/* Pending Scorecards */}
          <div className="border-t border-[#EDEDED] pt-3">
            <p className="text-xs text-[#585858] mb-2">
              {rd.pendingScorecards} ({scorecards.length})
            </p>
            <div className="space-y-2">
              {scorecards.slice(0, 2).map((sc) => (
                <div key={sc.interview.id} className="flex justify-between items-center h-10">
                  <div>
                    <p className="text-[13px] text-[#333]">
                      {sc.interview.candidate.firstName} {sc.interview.candidate.lastName} — {sc.interview.vacancy.title}
                    </p>
                    <p className="text-[11px] text-[#8B8B8B]">
                      {rd.evaluator}: {sc.role}
                    </p>
                  </div>
                  <button
                    onClick={() => toast(rd.remindComingSoon, { type: 'info' })}
                    className="text-xs text-[#1F114C] hover:underline"
                  >
                    {rd.remind}
                  </button>
                </div>
              ))}
              {scorecards.length > 2 && (
                <span className="text-xs text-[#DD0C15]">+{scorecards.length - 2} {rd.more}</span>
              )}
              {scorecards.length === 0 && (
                <p className="text-[11px] text-[#8B8B8B]">{rd.noPendingScorecards}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
