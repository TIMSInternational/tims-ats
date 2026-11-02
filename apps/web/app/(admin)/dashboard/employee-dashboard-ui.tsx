import { Skeleton } from '../../../components';

// Shared primitives for the employee "My Home" dashboard sections.

export const EMPTY_ICON = <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />;

export function ListSkeletonRows() {
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

export function ProgressBar({ value }: { value: number }) {
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
