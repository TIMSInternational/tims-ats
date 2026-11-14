'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate } from '../../../../../lib/candidate-format';
import { candidatePhase, collapseToPhases, phaseText } from './candidate-phase';
import { ErrorState } from '../../../../../components/error-state';
import { Skeleton } from '../../../../../components/skeleton';

// Stage timeline for ONE of the candidate's own applications (Wave 1 Slice 2).
// Lazily mounted when a row is expanded, so the detail query only fires on demand.
// Reads candidatePortal.applicationStatus, which is scoped server-side to this
// candidate (IDOR-safe) — the applicationId alone cannot reach another candidate.
// Shows candidate-facing phases (candidate-phase.ts), not the internal stage names: consecutive moves
// within one phase collapse into a single entry dated by the first of them.
export function DashboardApplicationTimeline({
  orgSlug,
  applicationId,
  timeZone = null,
}: {
  orgSlug: string;
  applicationId: string;
  timeZone?: string | null;
}) {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.applicationStatus.useQuery({
    orgSlug,
    applicationId,
  });

  if (isLoading) {
    return (
      <div className="mt-3 space-y-2 border-t border-border pt-3" aria-busy="true">
        <span className="sr-only">{t.portalDashboard.timelineLoading}</span>
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="mt-3 border-t border-border pt-3">
        <ErrorState size="inline" title={t.portalDashboard.timelineError} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (data.movements.length === 0) {
    return <p className="mt-3 text-callout text-secondary">{t.portalDashboard.timelineEmpty}</p>;
  }

  // The API returns moves newest-first. Collapse oldest-first (each phase is dated by when it began),
  // then show the phases newest-first again.
  const oldestFirst = [...data.movements].sort((a, b) => new Date(a.movedAt).getTime() - new Date(b.movedAt).getTime());
  // Only the latest move reflects the application's status (hired / closed); earlier ones were steps.
  const latest = oldestFirst[oldestFirst.length - 1];
  const phases = collapseToPhases(oldestFirst, (m) =>
    candidatePhase(m.toStage.name, m === latest ? data.status : 'active'),
  ).reverse();

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-callout font-semibold text-secondary">
        {t.portalDashboard.timelineTitle}
      </p>
      <ol className="space-y-2">
        {phases.map(({ phase, item: m }, i) => (
          <li key={`${m.movedAt}-${i}`} className="flex items-start gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-body font-medium text-primary">{phaseText(phase, t.portalDashboard).label}</span>
              <span className="text-callout text-secondary">{formatCandidateDate(m.movedAt, locale, timeZone)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
