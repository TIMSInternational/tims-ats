'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { useEngagementListActionPlans, useEngagementListLeaderCommitments } from '../../../lib/platform-api/engagement';
import { KpiCard, KpiCardSkeleton } from '../../../components';
import { LoadError } from './load-error';
import { OffersToApprovePanel, ScorecardsToSubmitPanel } from './manager-todos';

// Team lists are small; the list endpoints that take a limit (listOkrs) are
// capped here. listActionPlans / listLeaderCommitments take no limit and return
// the full (scope-narrowed) set, so we count the returned items directly.
const LIST_LIMIT = 100;

const CARD_DOT_COLORS = ['bg-blue-400', 'bg-green-400', 'bg-purple-400', 'bg-teal-400', 'bg-indigo-400'];

const CARD_BG_COLORS = ['bg-blue-50', 'bg-green-50', 'bg-purple-50', 'bg-teal-50', 'bg-indigo-50'];

function Dot({ index }: { index: number }) {
  return (
    <span className={`w-2.5 h-2.5 rounded-full inline-block ${CARD_DOT_COLORS[index % CARD_DOT_COLORS.length]}`} />
  );
}

export function ManagerDashboard() {
  const { t } = useI18n();
  const md = t.managerDashboard;

  // ── Available, scope-aware (team-slice) endpoints only ──
  const vac = trpc.vacancy.getDashboardKpis.useQuery();
  const cand = trpc.candidate.getDashboardKpis.useQuery();
  const offers = trpc.offer.getPending.useQuery();
  const scorecards = trpc.interview.getPendingScorecards.useQuery();
  const okrs = trpc.performance.listOkrs.useQuery({ limit: LIST_LIMIT, status: 'active' });
  const actionPlans = useEngagementListActionPlans();
  const commitments = useEngagementListLeaderCommitments();

  // Hiring KPI strip depends on these four queries.
  const hiringLoading = vac.isLoading || cand.isLoading || offers.isLoading || scorecards.isLoading;
  const hiringError = vac.isError || cand.isError || offers.isError || scorecards.isError;

  // Team KPI strip depends on these three queries.
  const teamLoading = okrs.isLoading || actionPlans.isLoading || commitments.isLoading;
  const teamError = okrs.isError || actionPlans.isError || commitments.isError;

  const offersCount = offers.data?.length ?? 0;
  const scorecardsCount = scorecards.data?.length ?? 0;
  // listOkrs already filters status: 'active' server-side.
  const activeOkrsCount = okrs.data?.okrs.length ?? 0;
  const openActionPlansCount = actionPlans.data?.filter((p) => p.status !== 'completed').length ?? 0;
  const openCommitmentsCount = commitments.data?.filter((c) => c.status !== 'fulfilled').length ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{md.title}</h1>
          <span className="text-[13px] text-[#585858]">{md.subtitle}</span>
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
          <OffersToApprovePanel data={offers.data} isLoading={offers.isLoading} isError={offers.isError} />
          <ScorecardsToSubmitPanel
            data={scorecards.data}
            isLoading={scorecards.isLoading}
            isError={scorecards.isError}
          />
        </div>

        {/* ── SECTION 2 — My Team ── */}
        <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{md.myTeam}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {teamError ? (
            <div className="col-span-full">
              <LoadError message={md.loadError} />
            </div>
          ) : teamLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={md.activeOkrs}
                value={activeOkrsCount}
                icon={<Dot index={0} />}
                iconBg={CARD_BG_COLORS[0]}
              />
              <KpiCard
                label={md.openActionPlans}
                value={openActionPlansCount}
                icon={<Dot index={1} />}
                iconBg={CARD_BG_COLORS[1]}
              />
              <KpiCard
                label={md.myCommitments}
                value={openCommitmentsCount}
                icon={<Dot index={2} />}
                iconBg={CARD_BG_COLORS[2]}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
