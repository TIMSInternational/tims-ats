'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { Skeleton, ErrorState } from '../../../../components';

interface CycleProgressPanelProps {
  cycleId: string;
}

/** Per-relationship submitted/total assignment counts for a cycle
 * (evaluation360.getCycleProgress) — an admin-only aggregate view, not
 * subject to the participant-facing min-3 anonymity rule (that rule governs
 * myReport's per-competency RATINGS, not raw assignment completion counts). */
export function CycleProgressPanel({ cycleId }: CycleProgressPanelProps) {
  const { t } = useI18n();
  const progress = trpc.evaluation360.getCycleProgress.useQuery({ cycleId });

  return (
    <div>
      <h3 className="text-[12px] font-semibold text-[#1F114C] mb-2.5">{t.evaluation360.progressTitle}</h3>
      {progress.isLoading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : progress.isError ? (
        <ErrorState onRetry={() => progress.refetch()} />
      ) : (
        <div className="space-y-2">
          {(progress.data?.progress ?? []).map((row) => {
            const pct = row.total > 0 ? Math.round((row.submitted / row.total) * 100) : 0;
            return (
              <div key={row.relationship} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-[11px] text-[#585858]">
                  {t.evaluation360.relationshipLabels[row.relationship]}
                </span>
                <div className="flex-1 h-2 bg-[#F6F6F6] rounded-full overflow-hidden">
                  <div className="h-full bg-[#1F114C] rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-[11px] text-[#333] font-medium">
                  {t.evaluation360.progressSubmittedOfTotal
                    .replace('{submitted}', String(row.submitted))
                    .replace('{total}', String(row.total))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
