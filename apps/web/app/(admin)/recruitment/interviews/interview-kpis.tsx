'use client';

import { useI18n } from '../../../../lib/i18n';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';

export type InterviewKpiCounts = { scheduled: number; completed: number; cancelled: number };

interface InterviewKpisProps {
  /** interview.list statusCounts: across all dates, by the rule the rows are badged with (A-02 / B-30). */
  counts: InterviewKpiCounts | null | undefined;
  /** How many interviews the current list (view + filters) has. */
  listTotal: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function InterviewKpis({ counts, listTotal, isLoading, isError, onRetry }: InterviewKpisProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
        <div className="col-span-2 md:col-span-4">
          <ErrorState onRetry={onRetry} />
        </div>
      </div>
    );
  }

  const cancelled = counts?.cancelled ?? 0;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
      <KpiCard
        label={t.interviews.kpiScheduled}
        value={counts?.scheduled ?? 0}
        subtitle={t.interviews.allDates}
        icon={
          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        }
        iconBg="bg-blue-50"
      />
      <KpiCard
        label={t.interviews.kpiCompleted}
        value={counts?.completed ?? 0}
        subtitle={t.interviews.allDates}
        icon={
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        iconBg="bg-green-50"
      />
      <KpiCard
        label={t.interviews.kpiCancelled}
        value={cancelled}
        subtitle={t.interviews.allDates}
        icon={
          <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        iconBg="bg-red-50"
        highlight={cancelled > 5}
      />
      <KpiCard
        label={t.interviews.kpiTotal}
        value={listTotal}
        subtitle={t.interviews.filteredTotal}
        icon={
          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        }
        iconBg="bg-amber-50"
      />
    </div>
  );
}
