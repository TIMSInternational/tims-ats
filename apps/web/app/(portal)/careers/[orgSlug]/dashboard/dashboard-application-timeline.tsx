'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';

// Stage timeline for ONE of the candidate's own applications (Wave 1 Slice 2).
// Lazily mounted when a row is expanded, so the detail query only fires on demand.
// Reads candidatePortal.applicationStatus, which is scoped server-side to this
// candidate (IDOR-safe) — the applicationId alone cannot reach another candidate.
export function DashboardApplicationTimeline({ orgSlug, applicationId }: { orgSlug: string; applicationId: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError } = trpc.candidatePortal.applicationStatus.useQuery({
    orgSlug,
    applicationId,
  });

  if (isLoading) {
    return <p className="text-[12px] text-[#8B8B8B] mt-3">{t.portalDashboard.timelineLoading}</p>;
  }
  if (isError || !data) {
    return <p className="text-[12px] text-[#B42318] mt-3">{t.portalDashboard.timelineError}</p>;
  }
  if (data.movements.length === 0) {
    return <p className="text-[12px] text-[#8B8B8B] mt-3">{t.portalDashboard.timelineEmpty}</p>;
  }

  return (
    <div className="mt-3 border-t border-[#EDEDED] pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B8B8B] mb-2">
        {t.portalDashboard.timelineTitle}
      </p>
      <ol className="space-y-2">
        {data.movements.map((m, i) => (
          <li key={`${m.movedAt}-${i}`} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1F114C]" aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] text-[#1F114C]">{m.toStage.name}</span>
              <span className="text-[11px] text-[#8B8B8B]">{new Date(m.movedAt).toLocaleDateString()}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
