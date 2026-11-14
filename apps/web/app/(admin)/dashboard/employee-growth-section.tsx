'use client';

import { useId } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../components';
import { LoadError } from './load-error';
import { ListSkeletonRows, RowProgress } from './employee-dashboard-ui';

// Own-scoped (auto-narrowed to the caller by scopeWhereFor — no userId is passed).
//
// "My Learning" note: there is no plain "list-my-enrollments" endpoint. The only
// own-scoped enrollment list is learning.getPrePostTestResults, which returns the
// caller's enrollments that have a pre/post-test score — the best own-scoped
// representation of "courses I'm engaged in". listCourses is the ORG catalog
// (unscoped) and is deliberately NOT used here.
const LIST_LIMIT = 100;

/** "My Performance" + "My Learning". Owns its queries, so NOT mounting it (pilot launch scope) means none
 *  of the performance / learning requests run. */
export function EmployeeGrowthSection() {
  const { t } = useI18n();
  const e = t.employeeHome;

  const okrs = trpc.performance.listOkrs.useQuery({ limit: LIST_LIMIT, status: 'active' });
  const coaching = trpc.performance.listCoachingSessions.useQuery({ limit: LIST_LIMIT });
  const feedback = trpc.performance.listFeedback.useQuery({ limit: LIST_LIMIT });
  const learning = trpc.learning.getPrePostTestResults.useQuery({});

  // Performance KPI strip depends on the three performance queries.
  const perfLoading = okrs.isLoading || coaching.isLoading || feedback.isLoading;
  const perfError = okrs.isError || coaching.isError || feedback.isError;

  const okrList = okrs.data?.okrs ?? [];
  const activeOkrsCount = okrList.length;
  const avgOkrProgress =
    activeOkrsCount > 0 ? Math.round(okrList.reduce((sum, o) => sum + o.progress, 0) / activeOkrsCount) : 0;
  const coachingCount = coaching.data?.sessions.length ?? 0;
  const feedbackCount = feedback.data?.feedbacks.length ?? 0;
  const enrolledCount = learning.data?.length ?? 0;

  const okrsId = useId();
  const retryPerf = () => {
    if (okrs.isError) okrs.refetch();
    if (coaching.isError) coaching.refetch();
    if (feedback.isError) feedback.refetch();
  };

  return (
    <>
      {/* ── SECTION 1 — My Performance ── */}
      <section>
        <h2 className="mb-3 text-heading font-semibold text-brand">{e.performance}</h2>
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          {perfError ? (
            <div className="col-span-full">
              <LoadError message={e.loadError} onRetry={retryPerf} />
            </div>
          ) : perfLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard label={e.activeOkrs} value={activeOkrsCount} subtitle={`${avgOkrProgress}% ${e.avgProgress}`} />
              <KpiCard label={e.coachingSessions} value={coachingCount} />
              <KpiCard label={e.feedback} value={feedbackCount} />
            </>
          )}
        </div>

        {/* My OKRs list */}
        <section aria-labelledby={okrsId} className="rounded-xl bg-white p-5 shadow-card">
          <h3 id={okrsId} className="mb-4 text-subheading font-semibold text-brand">
            {e.myOkrsTitle}
          </h3>
          {okrs.isError ? (
            <LoadError message={e.loadError} onRetry={() => okrs.refetch()} />
          ) : okrs.isLoading ? (
            <ListSkeletonRows />
          ) : okrList.length === 0 ? (
            <EmptyState size="compact" message={e.noOkrs} />
          ) : (
            <ul className="space-y-1">
              {okrList.map((okr) => (
                <li
                  key={okr.id}
                  className="-mx-3 flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0 truncate text-body font-medium text-primary">{okr.title}</span>
                  <RowProgress value={okr.progress} label={okr.title} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      {/* ── SECTION 2 — My Learning ── */}
      <section>
        <h2 className="mb-3 text-heading font-semibold text-brand">{e.learning}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {learning.isError ? (
            <div className="col-span-full">
              <LoadError message={e.loadError} onRetry={() => learning.refetch()} />
            </div>
          ) : learning.isLoading ? (
            <KpiCardSkeleton />
          ) : (
            // No "list-my-enrollments" endpoint exists; getPrePostTestResults is
            // the own-scoped enrollment list (those with a pre/post-test score).
            // A 0 count is a valid summary, so this renders the KPI card directly
            // rather than an EmptyState (the provided keys have no learning-empty
            // string, and inventing/borrowing one would mislabel the section).
            <KpiCard label={e.enrolledCourses} value={enrolledCount} />
          )}
        </div>
      </section>
    </>
  );
}
