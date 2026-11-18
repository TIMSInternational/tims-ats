'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { CommitteeCalibrationsPanel } from './committee-calibrations-panel';
import { formatInterviewWhen } from '../recruitment/interviews/interview-status';
import { interviewRoomHref } from './manager-todos';
import { DashboardPage } from './dashboard-page';

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

const ROW =
  '-mx-3 flex flex-wrap items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface';

function SkeletonRows() {
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

interface CommitteeTasksDashboardProps {
  /** Pilot launch scope: interview panels / scorecards only (no 9-box calibrations). */
  isPilot?: boolean;
}

export function CommitteeTasksDashboard({ isPilot = false }: CommitteeTasksDashboardProps) {
  const { t, locale } = useI18n();
  const ct = t.committeeTasks;

  // committee is evaluator-scoped: the one buildable task source is the
  // scope-aware pending-scorecards list (the member's own assignments).
  const scorecards = trpc.interview.getPendingScorecards.useQuery();
  // Interviews still to come are listed apart from the scorecards owed (B-29). Evaluator scope: the
  // member's own panels. `from` is fixed per visit so the query key stays stable.
  const [mountedAt] = useState(() => new Date());
  const upcoming = trpc.interview.list.useQuery({ from: mountedAt, openOnly: true, sort: 'asc', pageSize: 5 });
  const upcomingItems = upcoming.data?.items ?? [];

  const scorecardsCount = scorecards.data?.length ?? 0;
  const panelsId = useId();
  const upcomingId = useId();

  return (
    <DashboardPage title={ct.title} description={ct.subtitle}>
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {scorecards.isError ? (
          <div className="col-span-full">
            <LoadError message={ct.loadError} onRetry={() => scorecards.refetch()} />
          </div>
        ) : scorecards.isLoading ? (
          <KpiCardSkeleton />
        ) : (
          <KpiCard
            label={ct.pendingScorecards}
            value={scorecardsCount}
            tone="warning"
            highlight={scorecardsCount > 0}
          />
        )}
      </div>

      {/* Panels */}
      <section aria-labelledby={panelsId} className="rounded-xl bg-white p-5 shadow-card">
        <h2 id={panelsId} className="mb-4 text-heading font-semibold text-brand">
          {ct.panelsTitle}
        </h2>
        {scorecards.isError ? (
          <LoadError message={ct.loadError} onRetry={() => scorecards.refetch()} />
        ) : scorecards.isLoading ? (
          <SkeletonRows />
        ) : !scorecards.data || scorecards.data.length === 0 ? (
          <EmptyState size="compact" message={ct.noScorecards} />
        ) : (
          <ul className="space-y-1">
            {scorecards.data.map((row) => (
              <li key={row.id}>
                <a href={interviewRoomHref(row.interviewId)} className={ROW}>
                  <span className="min-w-0 truncate text-body font-medium text-primary">
                    {fullName(row.interview.candidate)}
                  </span>
                  <span className="min-w-0 truncate text-callout text-muted">
                    {[row.interview.vacancy.title, formatInterviewWhen(row.interview.scheduledAt, locale)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Upcoming panels — not scorecards yet */}
      <section aria-labelledby={upcomingId} className="mt-6 rounded-xl bg-white p-5 shadow-card">
        <h2 id={upcomingId} className="mb-4 text-heading font-semibold text-brand">
          {ct.upcomingTitle}
        </h2>
        {upcoming.isError ? (
          <LoadError message={ct.loadError} onRetry={() => upcoming.refetch()} />
        ) : upcoming.isLoading ? (
          <SkeletonRows />
        ) : upcomingItems.length === 0 ? (
          <EmptyState size="compact" message={ct.noUpcoming} />
        ) : (
          <ul className="space-y-1">
            {upcomingItems.map((iv) => (
              <li key={iv.id}>
                <Link href="/recruitment/interviews" className={ROW}>
                  <span className="min-w-0 truncate text-body font-medium text-primary">{fullName(iv.candidate)}</span>
                  <span className="min-w-0 truncate text-callout text-muted">
                    {[iv.vacancy.title, formatInterviewWhen(iv.scheduledAt, locale)].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Mis Calibraciones (talent / 9-box): not mounted under the pilot launch scope */}
      {!isPilot && <CommitteeCalibrationsPanel />}
    </DashboardPage>
  );
}
