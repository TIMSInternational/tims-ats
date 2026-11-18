'use client';

import { useId } from 'react';
import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { useEngagementListActionPlans, useEngagementListLeaderCommitments } from '../../../lib/platform-api/engagement';
import { KpiCard, KpiCardSkeleton, EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { DashboardPage } from './dashboard-page';
import { formatMessage } from '../../../lib/i18n/format';
import { vacancyStatusLabel } from '../recruitment/vacancies/vacancy-status';

// hrbp is UNIT-scoped: every query below is scope-aware and auto-narrowed to the
// hrbp's assigned units by scopeWhereFor (NOT an org rollup — those throw
// FORBIDDEN for unit scope). listOkrs takes a limit (capped at the schema max of
// 100 here); listActionPlans / listLeaderCommitments take no limit and return
// the full (scope-narrowed) set, so we count the returned items directly.
const OKR_LIST_LIMIT = 100;

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

export function UnitHealthDashboard() {
  const { t } = useI18n();
  const u = t.unitHealthDashboard;

  // ── Available, scope-aware (unit-slice) endpoints only ──
  const vac = trpc.vacancy.getDashboardKpis.useQuery();
  const cand = trpc.candidate.getDashboardKpis.useQuery();
  const okrs = trpc.performance.listOkrs.useQuery({ limit: OKR_LIST_LIMIT, status: 'active' });
  const actionPlans = useEngagementListActionPlans();
  const commitments = useEngagementListLeaderCommitments();

  // Recruiting KPI strip depends on the two scope-aware KPI queries.
  const recruitingLoading = vac.isLoading || cand.isLoading;
  const recruitingError = vac.isError || cand.isError;

  // People KPI strip depends on the three scope-aware list queries.
  const peopleLoading = okrs.isLoading || actionPlans.isLoading || commitments.isLoading;
  const peopleError = okrs.isError || actionPlans.isError || commitments.isError;

  const pendingApproval = vac.data?.totalPendingApproval ?? 0;
  // listOkrs already filters status: 'active' server-side.
  const activeOkrsCount = okrs.data?.okrs.length ?? 0;
  const openActionPlansCount = actionPlans.data?.filter((p) => p.status !== 'completed').length ?? 0;
  const openCommitmentsCount = commitments.data?.filter((c) => c.status !== 'fulfilled').length ?? 0;
  const recentId = useId();

  return (
    <DashboardPage title={u.title} description={u.subtitle}>
      {/* ── SECTION 1 — Unit Recruiting ── */}
      <h2 className="mb-3 text-heading font-semibold text-brand">{u.recruiting}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {recruitingError ? (
          <div className="col-span-full">
            <LoadError
              message={u.loadError}
              onRetry={() => {
                if (vac.isError) vac.refetch();
                if (cand.isError) cand.refetch();
              }}
            />
          </div>
        ) : recruitingLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard label={u.openVacancies} value={vac.data?.totalOpen ?? 0} />
            <KpiCard label={u.pendingApproval} value={pendingApproval} tone="warning" highlight={pendingApproval > 0} />
            <KpiCard label={u.activeCandidates} value={cand.data?.activeApplications ?? 0} />
            <KpiCard label={u.totalApplications} value={vac.data?.totalApplications ?? 0} />
          </>
        )}
      </div>

      {/* Recent Vacancies panel */}
      <section aria-labelledby={recentId} className="mb-8 rounded-xl bg-white p-5 shadow-card">
        <h3 id={recentId} className="mb-4 text-subheading font-semibold text-brand">
          {u.recentVacanciesTitle}
        </h3>
        {vac.isError ? (
          <LoadError message={u.loadError} onRetry={() => vac.refetch()} />
        ) : vac.isLoading ? (
          <VacancySkeletonRows />
        ) : !vac.data || vac.data.recentVacancies.length === 0 ? (
          <EmptyState size="compact" message={u.noVacancies} />
        ) : (
          <ul className="space-y-1">
            {vac.data.recentVacancies.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/recruitment/vacancies/${v.id}`}
                  className="-mx-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface"
                >
                  <span className="truncate text-body font-medium text-primary">{v.title}</span>
                  <span className="shrink-0 text-callout text-muted">
                    {vacancyStatusLabel(v.status, t.vacancies)} ·{' '}
                    {formatMessage(u.applicationsCount, { count: v._count.applications })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── SECTION 2 — Unit People ── */}
      <h2 className="mb-3 text-heading font-semibold text-brand">{u.people}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {peopleError ? (
          <div className="col-span-full">
            <LoadError
              message={u.loadError}
              onRetry={() => {
                if (okrs.isError) okrs.refetch();
                if (actionPlans.isError) actionPlans.refetch();
                if (commitments.isError) commitments.refetch();
              }}
            />
          </div>
        ) : peopleLoading ? (
          Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard label={u.activeOkrs} value={activeOkrsCount} />
            <KpiCard label={u.openActionPlans} value={openActionPlansCount} />
            <KpiCard label={u.leaderCommitments} value={openCommitmentsCount} />
          </>
        )}
      </div>
    </DashboardPage>
  );
}
