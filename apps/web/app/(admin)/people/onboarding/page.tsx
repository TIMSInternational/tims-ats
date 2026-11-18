'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { useCan } from '../../../../lib/permissions';
import { Button, KpiCard, KpiCardSkeleton, ErrorState, PageHeader } from '../../../../components';
import { CheckInCalendar } from './check-in-calendar';
import { useOnboardingOrgScope } from './use-onboarding-org-scope';
import { OnboardingTable, type OnboardingPlan } from './onboarding-table';
import { CreatePlanModal } from './create-plan-modal';
import { TasksByResponsible, PendingTasks } from './onboarding-panels';

/* ── KPI Icons (brand-tint tiles: the tile never implies a status the number does not have) ── */

const ICON = 'size-4';

function IconActive() {
  return (
    <svg className={ICON} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className={ICON} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg className={ICON} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function IconRisk() {
  return (
    <svg className={ICON} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className={ICON} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className={ICON} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

/* ── Page ───────────────────────────────────────────────────── */

const START_PHASES = ['day1_30', 'day31_60', 'day61_90'] as const;
type StartPhase = (typeof START_PHASES)[number];

function isStartPhase(value: string): value is StartPhase {
  return (START_PHASES as readonly string[]).includes(value);
}

export default function OnboardingPage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<StartPhase | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const can = useCan();
  // The KPI strip aggregates the whole organization: only org-wide readers ask for it (B-09 / E-08).
  const orgScope = useOnboardingOrgScope();
  const kpis = trpc.onboarding.getDashboardKpis.useQuery(undefined, { enabled: orgScope });
  // The tabs filter on the phase the START DATE gives today (the stored phase never advances). The server
  // applies it before paginating, and "Cargar más" reaches every page, so no hire drops out of a tab.
  const plans = trpc.onboarding.list.useInfiniteQuery(
    { limit: 50, status: 'active', ...(phase ? { startPhase: phase } : {}) },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const k = kpis.data;
  const items = (plans.data?.pages.flatMap((page) => page.plans) ?? []) as OnboardingPlan[];
  const overdueTasks = k?.overdueTasks ?? 0;
  const pendingTasks = k ? k.totalTasks - k.completedTasks : 0;
  const canUpdate = can('onboarding', 'update');

  const handlePhaseChange = (p: string) => {
    setPhase(isStartPhase(p) ? p : undefined);
  };

  const canCreate = can('onboarding', 'create');

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        title={t.onboarding.title}
        description={t.onboarding.pageDescription}
        actions={
          /* Creating a plan needs onboarding:create, which the leader does not hold (E-08). */
          canCreate ? (
            <Button icon={<PlusIcon />} onClick={() => setShowCreate(true)}>
              {t.onboarding.createPlanTitle}
            </Button>
          ) : undefined
        }
      />
      {showCreate && <CreatePlanModal onClose={() => setShowCreate(false)} />}

      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:space-y-6 md:p-6">
        {/* KPI Row — organization-wide readers only */}
        {orgScope && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
            {kpis.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
            ) : kpis.isError ? (
              <div className="col-span-2 sm:col-span-3 lg:col-span-5">
                <ErrorState size="compact" onRetry={() => kpis.refetch()} error={kpis.error} />
              </div>
            ) : (
              <>
                <KpiCard label={t.onboarding.kpiActivePlans} value={k?.activePlans ?? 0} icon={<IconActive />} />
                <KpiCard
                  label={t.onboarding.kpiCompletionRate}
                  value={`${k?.taskCompletionRate ?? 0}%`}
                  subtitle={t.onboarding.kpiCompletionRateDesc}
                  icon={<IconCheck />}
                />
                <KpiCard
                  label={t.onboarding.pendingTasks}
                  value={pendingTasks}
                  subtitle={t.onboarding.kpiPendingTasksDesc}
                  icon={<IconDoc />}
                />
                {/* B-23: a real count (due day passed, not completed) instead of a risk score nothing computes.
                    The danger tone colours it only when it is non-zero. */}
                <KpiCard
                  label={t.onboarding.kpiOverdue}
                  value={overdueTasks}
                  subtitle={t.onboarding.kpiOverdueDesc}
                  icon={<IconRisk />}
                  tone="danger"
                  highlight={overdueTasks > 0}
                />
                <KpiCard
                  label={t.onboarding.kpiOverdueCheckIns}
                  value={k?.overdueCheckIns ?? 0}
                  subtitle={t.onboarding.overdueCheckInDesc}
                  icon={<IconClock />}
                  tone="danger"
                />
              </>
            )}
          </div>
        )}

        {/* Active Onboardings Table */}
        {plans.isError ? (
          <div className="rounded-xl border border-border bg-white shadow-card">
            <ErrorState onRetry={() => plans.refetch()} error={plans.error} />
          </div>
        ) : (
          <div className="space-y-3">
            <OnboardingTable
              plans={items}
              isLoading={plans.isLoading}
              onPhaseChange={handlePhaseChange}
              onCreatePlan={canCreate ? () => setShowCreate(true) : undefined}
            />
            {plans.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void plans.fetchNextPage()}
                  disabled={plans.isFetchingNextPage}
                  loading={plans.isFetchingNextPage}
                >
                  {t.onboarding.loadMore}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Row 2: Tasks + pending */}
        {!plans.isError && (
          <div className="flex flex-col gap-4 md:flex-row">
            <TasksByResponsible plans={items} />
            <PendingTasks plans={items} />
          </div>
        )}

        {/* Only persisted check-ins are shown; elapsed days are not proof of completion. */}
        <CheckInCalendar
          plans={items}
          isLoading={plans.isLoading}
          isError={plans.isError}
          error={plans.error}
          onRetry={() => plans.refetch()}
          canUpdate={canUpdate}
        />
      </div>
    </div>
  );
}
