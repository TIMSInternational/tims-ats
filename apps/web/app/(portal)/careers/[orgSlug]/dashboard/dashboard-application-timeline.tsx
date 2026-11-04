'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate } from '../../../../../lib/candidate-format';
import { candidatePhase, collapseToPhases, phaseText } from './candidate-phase';

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
  const { data, isLoading, isError } = trpc.candidatePortal.applicationStatus.useQuery({
    orgSlug,
    applicationId,
  });

  if (isLoading) {
    return <p className="text-[12px] text-muted mt-3">{t.portalDashboard.timelineLoading}</p>;
  }
  if (isError || !data) {
    return <p className="text-[12px] text-[#B42318] mt-3">{t.portalDashboard.timelineError}</p>;
  }
  if (data.movements.length === 0) {
    return <p className="text-[12px] text-muted mt-3">{t.portalDashboard.timelineEmpty}</p>;
  }

  // The API returns moves newest-first. Collapse oldest-first (each phase is dated by when it began),
  // then show the phases newest-first again.
  const oldestFirst = [...data.movements].sort((a, b) => new Date(a.movedAt).getTime() - new Date(b.movedAt).getTime());
  const phases = collapseToPhases(oldestFirst, (m) => candidatePhase(m.toStage.name, 'active')).reverse();

  return (
    <div className="mt-3 border-t border-[#EDEDED] pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">
        {t.portalDashboard.timelineTitle}
      </p>
      <ol className="space-y-2">
        {phases.map(({ phase, item: m }, i) => (
          <li key={`${m.movedAt}-${i}`} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1F114C]" aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] text-[#1F114C]">{phaseText(phase, t.portalDashboard).label}</span>
              <span className="text-[11px] text-muted">{formatCandidateDate(m.movedAt, locale, timeZone)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
