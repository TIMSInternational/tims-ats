'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';

// employee is OWN-scoped: every query below is auto-narrowed to the caller by
// scopeWhereFor (we pass NO userId — that would widen, not narrow). No
// *.getDashboardKpis org-rollups (they throw FORBIDDEN at own scope) and no
// suppressedValue (own operational data is not a k-anon aggregate).
//
// "My Learning" note: there is no plain "list-my-enrollments" endpoint. The only
// own-scoped enrollment list is learning.getPrePostTestResults, which returns the
// caller's enrollments that have a pre/post-test score — the best own-scoped
// representation of "courses I'm engaged in". listCourses is the ORG catalog
// (unscoped) and is deliberately NOT used here.
const LIST_LIMIT = 100;

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

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

function ListSkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 ml-3 w-32 shrink-0">
      <div className="flex-1 h-1.5 rounded-full bg-[#EEE] overflow-hidden">
        <div className="h-full rounded-full bg-[#6C4FE0]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[13px] text-[#8B8B8B] w-9 text-right">{pct}%</span>
    </div>
  );
}

export function EmployeeHomeDashboard() {
  const { t } = useI18n();
  const e = t.employeeHome;

  // ── Own-scoped queries only (auto-filtered to the caller) ──
  const okrs = trpc.performance.listOkrs.useQuery({ limit: LIST_LIMIT, status: 'active' });
  const coaching = trpc.performance.listCoachingSessions.useQuery({ limit: LIST_LIMIT });
  const feedback = trpc.performance.listFeedback.useQuery({ limit: LIST_LIMIT });
  const learning = trpc.learning.getPrePostTestResults.useQuery({});
  const onboarding = trpc.onboarding.list.useQuery({ limit: 1, status: 'active' });

  // Performance KPI strip depends on the three performance queries.
  const perfLoading = okrs.isLoading || coaching.isLoading || feedback.isLoading;
  const perfError = okrs.isError || coaching.isError || feedback.isError;

  const okrList = okrs.data?.okrs ?? [];
  const activeOkrsCount = okrList.length;
  const avgOkrProgress =
    activeOkrsCount > 0
      ? Math.round(okrList.reduce((sum, o) => sum + o.progress, 0) / activeOkrsCount)
      : 0;
  const coachingCount = coaching.data?.sessions.length ?? 0;
  const feedbackCount = feedback.data?.feedbacks.length ?? 0;

  const enrolledCount = learning.data?.length ?? 0;

  // onboarding.list is conditional on being a new hire; an empty list = no plan.
  const onboardingPlan = onboarding.data?.plans[0];
  const onboardingProgress = (() => {
    const tasks = onboardingPlan?.tasks ?? [];
    if (tasks.length === 0) return 0;
    return Math.round((tasks.filter((task) => task.completed).length / tasks.length) * 100);
  })();

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{e.title}</h1>
          <span className="text-[13px] text-[#585858]">{e.subtitle}</span>
        </div>

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
              <KpiCard
                label={e.feedback}
                value={feedbackCount}
                icon={<Dot index={2} />}
                iconBg={CARD_BG_COLORS[2]}
              />
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
                <div
                  key={okr.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3"
                >
                  <span className="text-sm text-[#333] font-medium truncate">
                    {okr.title}
                  </span>
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

        {/* ── SECTION 3 — My Onboarding ── */}
        <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{e.onboarding}</h2>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          {onboarding.isError ? (
            <LoadError message={e.loadError} />
          ) : onboarding.isLoading ? (
            <ListSkeletonRows />
          ) : !onboardingPlan ? (
            <EmptyState icon={EMPTY_ICON} message={e.noOnboarding} />
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#333] font-medium">
                {e.onboardingProgress}
              </span>
              <ProgressBar value={onboardingProgress} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
