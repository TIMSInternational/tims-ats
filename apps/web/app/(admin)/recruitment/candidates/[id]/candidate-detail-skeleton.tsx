'use client';

import { Skeleton } from '../../../../../components';

/** The candidate page while the candidate loads. */
export function CandidateDetailSkeleton() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
        <Skeleton className="h-5 w-64 rounded" />
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <Skeleton className="h-40 w-full rounded-xl mb-6" />
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:flex-[60] space-y-4">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <div className="w-full md:flex-[40] space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
