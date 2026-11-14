'use client';

import { Skeleton } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

/** Loading placeholder for the board: columns for kanban, rows for the list and table views. */
export function PipelineBoardSkeleton({ kanban }: { kanban: boolean }) {
  const { t } = useI18n();
  // Screen readers hear "Cargando el pipeline" instead of silence (progress-indicators.md).
  const status = (
    <span role="status" className="sr-only">
      {t.pipeline.loadingBoard}
    </span>
  );
  if (kanban) {
    return (
      <div aria-busy="true" className="flex gap-3 h-full">
        {status}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} aria-hidden="true" className="w-60 shrink-0 flex flex-col bg-surface rounded-xl overflow-hidden">
            <div className="h-1 bg-border" />
            <div className="px-3 py-3 bg-white border-b border-border">
              <Skeleton className="h-5 w-24 rounded" />
            </div>
            <div className="flex-1 p-2 space-y-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-busy="true" className="bg-white rounded-xl shadow-card p-4">
      {status}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-4 py-3 border-b border-border">
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-20 rounded" />
          <Skeleton className="h-4 w-12 rounded" />
        </div>
      ))}
    </div>
  );
}
