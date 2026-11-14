'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { Button, ErrorState, Skeleton, StatusBadge, type StatusTone } from '../../../../../components';

const ACTIVE_STATUSES = new Set(['assigned', 'in_progress']);
const STATUS_TONE: Record<string, StatusTone> = { assigned: 'brand', in_progress: 'warning', completed: 'success' };

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

// "My Assessments" section of the candidate dashboard (Wave 1.5a Slice 4). Lists
// the signed-in candidate's assessment assignments and links a startable one into
// the Slice 3 player. Data comes from candidatePortal.getMyAssessments, scoped
// server-side to this candidate; orgSlug is the only input.
// `hideWhenEmpty`: the TIMS "Online assessments" section is on, so an empty list of the company's own quizzes is noise
// above it (the candidate saw "no assessments yet" right over four TIMS tests).
export function DashboardAssessments({ orgSlug, hideWhenEmpty = false }: { orgSlug: string; hideWhenEmpty?: boolean }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug });

  const header = (
    <h2 id="native-assessments-heading" className="mb-3 text-subheading font-semibold text-brand">
      {t.portalDashboard.assessments}
    </h2>
  );
  const sectionClass = 'rounded-2xl border border-border bg-white p-4 sm:p-5';

  if (isLoading) {
    if (hideWhenEmpty) return null;
    return (
      <section aria-labelledby="native-assessments-heading" aria-busy="true" className={sectionClass}>
        {header}
        <span className="sr-only">{t.portalDashboard.assessLoading}</span>
        <Skeleton className="h-16 w-full rounded-xl" />
      </section>
    );
  }
  if (isError) {
    return (
      <section aria-labelledby="native-assessments-heading" className={sectionClass}>
        {header}
        <ErrorState size="compact" title={t.portalDashboard.assessError} onRetry={() => void refetch()} />
      </section>
    );
  }

  const assignments = data ?? [];
  if (hideWhenEmpty && assignments.length === 0) return null;

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
        // Never show a raw status code: anything not started reads as "not started".
        return t.portalDashboard.assessStatusAssigned;
    }
  };

  return (
    <section aria-labelledby="native-assessments-heading" className={sectionClass}>
      {header}

      {assignments.length === 0 ? (
        <p className="text-body text-secondary">{t.portalDashboard.assessEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {assignments.map((assignment) => {
            const expired = ACTIVE_STATUSES.has(assignment.status) && isExpired(assignment.expiresAt);
            const active = ACTIVE_STATUSES.has(assignment.status) && !expired;
            return (
              <li key={assignment.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-subheading font-semibold text-brand">
                      {assignment.assessmentType.name}
                    </p>
                    {assignment.assessmentType.duration !== null && (
                      <p className="mt-1 text-caption text-secondary">
                        {assignment.assessmentType.duration} {t.portalDashboard.assessMinutes}
                      </p>
                    )}
                  </div>
                  <StatusBadge
                    tone={expired ? 'neutral' : (STATUS_TONE[assignment.status] ?? 'neutral')}
                    className="shrink-0"
                  >
                    {statusLabel(assignment.status, expired)}
                  </StatusBadge>
                </div>

                {assignment.status === 'completed' && (
                  <p className="mt-2 text-callout text-secondary">
                    {assignment.result?.hasPending
                      ? t.portalDashboard.assessPendingNotice
                      : `${t.portalDashboard.assessScoreLabel}: ${assignment.result?.normalizedScore ?? '—'}`}
                  </p>
                )}

                {active && (
                  <Button
                    href={`/careers/${orgSlug}/dashboard/assessments/${assignment.id}`}
                    size="lg"
                    className="mt-3 w-full sm:w-auto"
                  >
                    {assignment.status === 'in_progress'
                      ? t.portalDashboard.assessContinue
                      : t.portalDashboard.assessStart}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
