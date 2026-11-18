'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton } from '../../../components';
import { LoadError } from './load-error';
import { ScorecardsToSubmitPanel } from './manager-todos';
import { MyApprovalsCard } from './my-approvals-card';
import { ManagerTeamSection } from './manager-team-section';
import { DashboardPage } from './dashboard-page';

interface ManagerDashboardProps {
  /** Pilot launch scope: hiring only (requisitions, offer approvals, interview scorecards). */
  isPilot?: boolean;
}

export function ManagerDashboard({ isPilot = false }: ManagerDashboardProps) {
  const { t } = useI18n();
  const md = t.managerDashboard;

  // ── Available, scope-aware (team-slice) endpoints only ──
  const vac = trpc.vacancy.getDashboardKpis.useQuery();
  const cand = trpc.candidate.getDashboardKpis.useQuery();
  const offers = trpc.offer.getPending.useQuery();
  const scorecards = trpc.interview.getPendingScorecards.useQuery();

  // Hiring KPI strip depends on these four queries.
  const hiringLoading = vac.isLoading || cand.isLoading || offers.isLoading || scorecards.isLoading;
  const hiringError = vac.isError || cand.isError || offers.isError || scorecards.isError;

  return (
    <DashboardPage
      title={md.title}
      // The team section is not mounted in the pilot, so the subtitle names only the hiring part.
      description={isPilot ? md.subtitlePilot : md.subtitle}
    >
      {/* ── SECTION 1 — My Hiring: the two to-do lists lead (they carry the actions and their counts) ── */}
      <h2 className="mb-3 text-heading font-semibold text-brand">{md.myHiring}</h2>
      <div className="mb-6 flex flex-col gap-4 md:flex-row">
        <MyApprovalsCard />
        <ScorecardsToSubmitPanel
          data={scorecards.data}
          isLoading={scorecards.isLoading}
          isError={scorecards.isError}
          onRetry={() => scorecards.refetch()}
        />
      </div>

      {/* Only the figures the lists above do not already show. */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:max-w-2xl">
        {hiringError ? (
          <div className="col-span-full">
            <LoadError
              message={md.loadError}
              onRetry={() => {
                for (const q of [vac, cand, offers, scorecards]) if (q.isError) q.refetch();
              }}
            />
          </div>
        ) : hiringLoading ? (
          Array.from({ length: 2 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard label={md.openVacancies} value={vac.data?.totalOpen ?? 0} />
            <KpiCard label={md.activeCandidates} value={cand.data?.activeApplications ?? 0} />
          </>
        )}
      </div>

      {/* ── SECTION 2 — My Team (performance + engagement): not mounted under the pilot launch scope ── */}
      {!isPilot && <ManagerTeamSection />}
    </DashboardPage>
  );
}
