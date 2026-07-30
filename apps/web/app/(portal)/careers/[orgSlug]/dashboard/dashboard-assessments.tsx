'use client';

import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';

const ACTIVE_STATUSES = new Set(['assigned', 'in_progress']);

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

// "My Assessments" section of the candidate dashboard (Wave 1.5a Slice 4). Lists
// the signed-in candidate's assessment assignments and links a startable one into
// the Slice 3 player. Data comes from candidatePortal.getMyAssessments, scoped
// server-side to this candidate; orgSlug is the only input.
export function DashboardAssessments({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError } = trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug });

  const header = <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.portalDashboard.assessments}</h2>;

  if (isLoading) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.assessLoading}</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-[#B42318]">{t.portalDashboard.assessError}</p>
      </section>
    );
  }

  const assignments = data ?? [];

  const statusLabel = (status: string, expired: boolean) => {
    if (expired) return t.portalDashboard.assessStatusExpired;
    switch (status) {
      case 'assigned':
        return t.portalDashboard.assessStatusAssigned;
      case 'in_progress':
        return t.portalDashboard.assessStatusInProgress;
      case 'completed':
        return t.portalDashboard.assessStatusCompleted;
      case 'cancelled':
        return t.portalDashboard.assessStatusCancelled;
      default:
        return status;
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      {header}

      {assignments.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.assessEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {assignments.map((assignment) => {
            const expired = ACTIVE_STATUSES.has(assignment.status) && isExpired(assignment.expiresAt);
            const active = ACTIVE_STATUSES.has(assignment.status) && !expired;
            return (
              <li key={assignment.id} className="rounded-xl border border-[#EDEDED] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#1F114C] truncate">
                      {assignment.assessmentType.name}
                    </p>
                    {assignment.assessmentType.duration !== null && (
                      <p className="text-[11px] text-[#8B8B8B] mt-1">
                        {assignment.assessmentType.duration} {t.portalDashboard.assessMinutes}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-[#F4F1FF] px-2.5 py-1 text-[11px] font-medium text-[#1F114C]">
                    {statusLabel(assignment.status, expired)}
                  </span>
                </div>

                {assignment.status === 'completed' && (
                  <p className="text-[12px] text-[#585858] mt-2">
                    {assignment.result?.hasPending
                      ? t.portalDashboard.assessPendingNotice
                      : `${t.portalDashboard.assessScoreLabel}: ${assignment.result?.normalizedScore ?? '—'}`}
                  </p>
                )}

                {active && (
                  <Link
                    href={`/careers/${orgSlug}/dashboard/assessments/${assignment.id}`}
                    className="mt-3 inline-flex h-9 items-center rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] transition"
                  >
                    {assignment.status === 'in_progress'
                      ? t.portalDashboard.assessContinue
                      : t.portalDashboard.assessStart}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
