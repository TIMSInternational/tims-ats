'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../components';
import { LoadError } from './load-error';
import { CARD_BG_COLORS, Dot } from './dashboard-dot';
import { EMPTY_ICON, ListSkeletonRows, ProgressBar } from './employee-dashboard-ui';

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

  return (
    <>
      {/* ── SECTION 1 — My Performance ── */}
      <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{e.performance}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {perfError ? (
          <div className="col-span-full">
            <LoadError message={e.loadError} />
          </div>
        ) : perfLoading ? (
          Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard
              label={e.activeOkrs}
              value={activeOkrsCount}
              subtitle={`${avgOkrProgress}% ${e.avgProgress}`}
              icon={<Dot index={0} />}
              iconBg={CARD_BG_COLORS[0]}
            />
            <KpiCard
              label={e.coachingSessions}
              value={coachingCount}
              icon={<Dot index={1} />}
              iconBg={CARD_BG_COLORS[1]}
            />
            <KpiCard label={e.feedback} value={feedbackCount} icon={<Dot index={2} />} iconBg={CARD_BG_COLORS[2]} />
          </>
        )}
      </div>

      {/* My OKRs list */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-8">
        <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{e.myOkrsTitle}</h2>
        {okrs.isError ? (
          <LoadError message={e.loadError} />
        ) : okrs.isLoading ? (
          <ListSkeletonRows />
        ) : okrList.length === 0 ? (
          <EmptyState icon={EMPTY_ICON} message={e.noOkrs} />
        ) : (
          <div className="space-y-1">
            {okrList.map((okr) => (
              <div key={okr.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3">
                <span className="text-sm text-[#333] font-medium truncate">{okr.title}</span>
                <ProgressBar value={okr.progress} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── SECTION 2 — My Learning ── */}
      <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{e.learning}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {learning.isError ? (
          <div className="col-span-full">
            <LoadError message={e.loadError} />
          </div>
        ) : learning.isLoading ? (
          <KpiCardSkeleton />
        ) : (
          // No "list-my-enrollments" endpoint exists; getPrePostTestResults is
          // the own-scoped enrollment list (those with a pre/post-test score).
          // A 0 count is a valid summary, so this renders the KPI card directly
          // rather than an EmptyState (the provided keys have no learning-empty
          // string, and inventing/borrowing one would mislabel the section).
          <KpiCard
            label={e.enrolledCourses}
            value={enrolledCount}
            icon={<Dot index={3} />}
            iconBg={CARD_BG_COLORS[3]}
          />
        )}
      </div>
    </>
  );
}
