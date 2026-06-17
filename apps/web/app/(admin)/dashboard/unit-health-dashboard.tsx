'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';

// hrbp is UNIT-scoped: every query below is scope-aware and auto-narrowed to the
// hrbp's assigned units by scopeWhereFor (NOT an org rollup — those throw
// FORBIDDEN for unit scope). listOkrs takes a limit (capped at the schema max of
// 100 here); listActionPlans / listLeaderCommitments take no limit and return
// the full (scope-narrowed) set, so we count the returned items directly.
const OKR_LIST_LIMIT = 100;

const CARD_DOT_COLORS = [
  'bg-blue-400',
  'bg-green-400',
  'bg-purple-400',
  'bg-teal-400',
  'bg-indigo-400',
];

const CARD_BG_COLORS = [
  'bg-blue-50',
  'bg-green-50',
  'bg-purple-50',
  'bg-teal-50',
  'bg-indigo-50',
];

function Dot({ index }: { index: number }) {
  return (
    <span
      className={`w-2.5 h-2.5 rounded-full inline-block ${CARD_DOT_COLORS[index % CARD_DOT_COLORS.length]}`}
    />
  );
}

function VacancySkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

export function UnitHealthDashboard() {
  const { t } = useI18n();
  const u = t.unitHealthDashboard;

  // ── Available, scope-aware (unit-slice) endpoints only ──
  const vac = trpc.vacancy.getDashboardKpis.useQuery();
  const cand = trpc.candidate.getDashboardKpis.useQuery();
  const okrs = trpc.performance.listOkrs.useQuery({ limit: OKR_LIST_LIMIT, status: 'active' });
  const actionPlans = trpc.engagement.listActionPlans.useQuery();
  const commitments = trpc.engagement.listLeaderCommitments.useQuery();

  // Recruiting KPI strip depends on the two scope-aware KPI queries.
  const recruitingLoading = vac.isLoading || cand.isLoading;
  const recruitingError = vac.isError || cand.isError;

  // People KPI strip depends on the three scope-aware list queries.
  const peopleLoading = okrs.isLoading || actionPlans.isLoading || commitments.isLoading;
  const peopleError = okrs.isError || actionPlans.isError || commitments.isError;

  const pendingApproval = vac.data?.totalPendingApproval ?? 0;
  // listOkrs already filters status: 'active' server-side.
  const activeOkrsCount = okrs.data?.okrs.length ?? 0;
  const openActionPlansCount =
    actionPlans.data?.filter((p) => p.status !== 'completed').length ?? 0;
  const openCommitmentsCount =
    commitments.data?.filter((c) => c.status !== 'fulfilled').length ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{u.title}</h1>
          <span className="text-[13px] text-[#585858]">{u.subtitle}</span>
        </div>

        {/* ── SECTION 1 — Unit Recruiting ── */}
        <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{u.recruiting}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
          {recruitingError ? (
            <div className="col-span-full">
              <LoadError message={u.loadError} />
            </div>
          ) : recruitingLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={u.openVacancies}
                value={vac.data?.totalOpen ?? 0}
                icon={<Dot index={0} />}
                iconBg={CARD_BG_COLORS[0]}
              />
              <KpiCard
                label={u.pendingApproval}
                value={pendingApproval}
                icon={<Dot index={1} />}
                iconBg={CARD_BG_COLORS[1]}
                highlight={pendingApproval > 0}
              />
              <KpiCard
                label={u.activeCandidates}
                value={cand.data?.activeApplications ?? 0}
                icon={<Dot index={2} />}
                iconBg={CARD_BG_COLORS[2]}
              />
              <KpiCard
                label={u.totalApplications}
                value={vac.data?.totalApplications ?? 0}
                icon={<Dot index={3} />}
                iconBg={CARD_BG_COLORS[3]}
              />
            </>
          )}
        </div>

        {/* Recent Vacancies panel */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-8">
          <h2 className="text-sm font-semibold text-[#1F114C] mb-4">
            {u.recentVacanciesTitle}
          </h2>
          {vac.isError ? (
            <LoadError message={u.loadError} />
          ) : vac.isLoading ? (
            <VacancySkeletonRows />
          ) : !vac.data || vac.data.recentVacancies.length === 0 ? (
            <EmptyState icon={EMPTY_ICON} message={u.noVacancies} />
          ) : (
            <div className="space-y-1">
              {vac.data.recentVacancies.map((v) => (
                <Link
                  key={v.id}
                  href={`/recruitment/vacancies/${v.id}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3 hover:bg-[#F6F6F6] transition"
                >
                  <span className="text-sm text-[#333] font-medium truncate">
                    {v.title}
                  </span>
                  <span className="text-[13px] text-[#8B8B8B] truncate ml-3">
                    {v.status} · {v._count.applications}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── SECTION 2 — Unit People ── */}
        <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{u.people}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {peopleError ? (
            <div className="col-span-full">
              <LoadError message={u.loadError} />
            </div>
          ) : peopleLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={u.activeOkrs}
                value={activeOkrsCount}
                icon={<Dot index={0} />}
                iconBg={CARD_BG_COLORS[0]}
              />
              <KpiCard
                label={u.openActionPlans}
                value={openActionPlansCount}
                icon={<Dot index={1} />}
                iconBg={CARD_BG_COLORS[1]}
              />
              <KpiCard
                label={u.leaderCommitments}
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
