import { Skeleton } from '../../../../../components/skeleton';

/**
 * Loading placeholder in the shape of a dashboard item (title, meta line, status chip), so the card does not
 * jump when the data arrives. `label` is the section's existing "Cargando…" string, read by screen readers.
 */
export function DashboardCardSkeleton({ label, rows = 2 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start justify-between gap-3 rounded-xl border border-border p-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
