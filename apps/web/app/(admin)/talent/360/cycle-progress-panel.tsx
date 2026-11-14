'use client';

import { useEvaluation360CycleProgress } from '../../../../lib/platform-api/evaluation360';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { Skeleton, ErrorState, ProgressBar } from '../../../../components';

interface CycleProgressPanelProps {
  cycleId: string;
}

/** Per-relationship submitted/total assignment counts for a cycle
 * (evaluation360.getCycleProgress) — an admin-only aggregate view, not
 * subject to the participant-facing min-3 anonymity rule (that rule governs
 * myReport's per-competency RATINGS, not raw assignment completion counts). */
export function CycleProgressPanel({ cycleId }: CycleProgressPanelProps) {
  const { t } = useI18n();
  const progress = useEvaluation360CycleProgress(cycleId);
  const rows = progress.data?.progress ?? [];

  return (
    <section aria-labelledby={`progress-${cycleId}`}>
      <h3 id={`progress-${cycleId}`} className="mb-2.5 text-subheading font-semibold text-brand">
        {t.evaluation360.progressTitle}
      </h3>
      {progress.isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      ) : progress.isError ? (
        <ErrorState size="compact" error={progress.error} onRetry={() => progress.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-callout text-secondary">{t.evaluation360.progressEmpty}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const label = t.evaluation360.relationshipLabels[row.relationship];
            const valueText = formatMessage(t.evaluation360.progressSubmittedOfTotal, {
              submitted: row.submitted,
              total: row.total,
            });
            return (
              <div key={row.relationship} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-callout text-secondary">{label}</span>
                <ProgressBar
                  value={row.submitted}
                  max={Math.max(row.total, 1)}
                  label={label}
                  hideLabel
                  valueText={valueText}
                  className="flex-1"
                />
                <span className="w-24 shrink-0 text-right text-callout font-medium tabular-nums text-primary">
                  {valueText}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
