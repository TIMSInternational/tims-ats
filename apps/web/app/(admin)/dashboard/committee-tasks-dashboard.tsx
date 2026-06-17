'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

const CARD_ICON = <span className="w-2.5 h-2.5 rounded-full inline-block bg-blue-400" />;
const CARD_BG = 'bg-blue-50';

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

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

export function CommitteeTasksDashboard() {
  const { t } = useI18n();
  const ct = t.committeeTasks;

  // committee is evaluator-scoped: the one buildable task source is the
  // scope-aware pending-scorecards list (the member's own assignments).
  const scorecards = trpc.interview.getPendingScorecards.useQuery();

  const scorecardsCount = scorecards.data?.length ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{ct.title}</h1>
          <span className="text-[13px] text-[#585858]">{ct.subtitle}</span>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
          {scorecards.isError ? (
            <div className="col-span-full">
              <LoadError message={ct.loadError} />
            </div>
          ) : scorecards.isLoading ? (
            <KpiCardSkeleton />
          ) : (
            <KpiCard
              label={ct.pendingScorecards}
              value={scorecardsCount}
              icon={CARD_ICON}
              iconBg={CARD_BG}
              highlight={scorecardsCount > 0}
            />
          )}
        </div>

        {/* Panels */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{ct.panelsTitle}</h2>
          {scorecards.isError ? (
            <LoadError message={ct.loadError} />
          ) : scorecards.isLoading ? (
            <SkeletonRows />
          ) : !scorecards.data || scorecards.data.length === 0 ? (
            <EmptyState icon={EMPTY_ICON} message={ct.noScorecards} />
          ) : (
            <div className="space-y-1">
              {scorecards.data.map((row) => (
                <Link
                  key={row.id}
                  href="/recruitment/interviews"
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3 hover:bg-[#F6F6F6] transition"
                >
                  <span className="text-sm text-[#333] font-medium truncate">
                    {fullName(row.interview.candidate)}
                  </span>
                  <span className="text-[13px] text-[#8B8B8B] truncate ml-3">
                    {row.interview.vacancy.title}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
