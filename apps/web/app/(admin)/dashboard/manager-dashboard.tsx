'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton } from '../../../components';
import { LoadError } from './load-error';
import { ScorecardsToSubmitPanel } from './manager-todos';
import { MyApprovalsCard } from './my-approvals-card';
import { ManagerTeamSection } from './manager-team-section';
import { CARD_BG_COLORS, Dot } from './dashboard-dot';

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

  const offersCount = offers.data?.length ?? 0;
  const scorecardsCount = scorecards.data?.length ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{md.title}</h1>
          {/* The team section is not mounted in the pilot, so the subtitle names only the hiring part. */}
          <span className="text-[13px] text-[#585858]">{isPilot ? md.subtitlePilot : md.subtitle}</span>
        </div>

        {/* ── SECTION 1 — My Hiring ── */}
        <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{md.myHiring}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
          {hiringError ? (
            <div className="col-span-full">
              <LoadError message={md.loadError} />
            </div>
          ) : hiringLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={md.openVacancies}
                value={vac.data?.totalOpen ?? 0}
                icon={<Dot index={0} />}
                iconBg={CARD_BG_COLORS[0]}
              />
              <KpiCard
                label={md.activeCandidates}
                value={cand.data?.activeApplications ?? 0}
                icon={<Dot index={1} />}
                iconBg={CARD_BG_COLORS[1]}
              />
              <KpiCard
                label={md.offersToApprove}
                value={offersCount}
                icon={<Dot index={2} />}
                iconBg={CARD_BG_COLORS[2]}
                highlight={offersCount > 0}
              />
              <KpiCard
                label={md.scorecardsToSubmit}
                value={scorecardsCount}
                icon={<Dot index={3} />}
                iconBg={CARD_BG_COLORS[3]}
                highlight={scorecardsCount > 0}
              />
            </>
          )}
        </div>

        {/* My Hiring to-do panels */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <MyApprovalsCard />
          <ScorecardsToSubmitPanel
            data={scorecards.data}
            isLoading={scorecards.isLoading}
            isError={scorecards.isError}
          />
        </div>

        {/* ── SECTION 2 — My Team (performance + engagement): not mounted under the pilot launch scope ── */}
        {!isPilot && <ManagerTeamSection />}
      </div>
    </div>
  );
}
