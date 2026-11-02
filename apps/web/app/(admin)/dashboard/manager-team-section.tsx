'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { useEngagementListActionPlans, useEngagementListLeaderCommitments } from '../../../lib/platform-api/engagement';
import { KpiCard, KpiCardSkeleton } from '../../../components';
import { LoadError } from './load-error';
import { CARD_BG_COLORS, Dot } from './dashboard-dot';

// Team lists are small; the list endpoints that take a limit (listOkrs) are
// capped here. listActionPlans / listLeaderCommitments take no limit and return
// the full (scope-narrowed) set, so we count the returned items directly.
const LIST_LIMIT = 100;

/** "My Team" (performance + engagement). Owns its queries, so NOT mounting it (pilot launch scope) means
 *  none of the performance / engagement requests run. */
export function ManagerTeamSection() {
  const { t } = useI18n();
  const md = t.managerDashboard;

  const okrs = trpc.performance.listOkrs.useQuery({ limit: LIST_LIMIT, status: 'active' });
  const actionPlans = useEngagementListActionPlans();
  const commitments = useEngagementListLeaderCommitments();

  const teamLoading = okrs.isLoading || actionPlans.isLoading || commitments.isLoading;
  const teamError = okrs.isError || actionPlans.isError || commitments.isError;

  // listOkrs already filters status: 'active' server-side.
  const activeOkrsCount = okrs.data?.okrs.length ?? 0;
  const openActionPlansCount = actionPlans.data?.filter((p) => p.status !== 'completed').length ?? 0;
  const openCommitmentsCount = commitments.data?.filter((c) => c.status !== 'fulfilled').length ?? 0;

  return (
    <>
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
    </>
  );
}
