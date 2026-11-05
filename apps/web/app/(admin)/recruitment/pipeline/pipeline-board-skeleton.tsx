'use client';

import { Skeleton } from '../../../../components';

/** Loading placeholder for the board: columns for kanban, rows for the list and table views. */
export function PipelineBoardSkeleton({ kanban }: { kanban: boolean }) {
  if (kanban) {
    return (
      <div className="flex gap-3 h-full">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="min-w-[240px] max-w-[240px] flex flex-col bg-[#F0EEF5]/50 rounded-xl overflow-hidden">
            <div className="px-3 py-3 bg-[#E8E5F0]">
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
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3 border-b border-[#F0F0F0]">
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
