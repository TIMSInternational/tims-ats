'use client';

import { useI18n } from '../../../../../lib/i18n';
import { Skeleton } from '../../../../../components';

/**
 * The candidate page while the candidate loads: the same shape as the loaded page (header, summary card,
 * tab row, record grid), so nothing jumps when the data arrives (loading.md › Best practices).
 */
export function CandidateDetailSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col overflow-hidden" aria-busy="true">
      <span className="sr-only" role="status">
        {t.candidates.loadingCandidate}
      </span>
      <div className="flex min-h-16 shrink-0 flex-col justify-center gap-1.5 border-b border-border bg-white px-4 py-3 md:px-6">
        <Skeleton className="h-3 w-20 rounded" />
        <Skeleton className="h-6 w-56 rounded" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6" aria-hidden="true">
        <Skeleton className="mb-6 h-28 w-full rounded-xl" />
        <div className="mb-6 flex gap-2 overflow-hidden border-b border-border pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 rounded" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
