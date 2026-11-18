import { Skeleton } from '../../../components';
import { ProgressBar } from '../../../components/progress-bar';

// Shared primitives for the employee "My Home" dashboard sections.

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

/**
 * A row's progress: the shared determinate bar (role=progressbar, named after the row) on the brand fill,
 * with the percentage beside it.
 */
export function RowProgress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex w-full items-center gap-2 sm:w-40 sm:shrink-0">
      <ProgressBar value={pct} label={label} valueText={`${pct}%`} hideLabel className="flex-1" />
      <span className="w-10 text-right text-callout tabular-nums text-secondary" aria-hidden="true">
        {pct}%
      </span>
    </div>
  );
}
