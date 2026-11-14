'use client';

import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { isForbiddenError } from '../../../../lib/forbidden-error';
import { formatPercent } from '../../../../lib/format-utils';

export interface DashboardKpis {
  activeOkrs: number;
  averageOkrProgress: number;
  scheduledSessions: number;
  completedSessions: number;
  pendingCommitments: number;
  completedCommitments: number;
  commitmentCompletionRate: number;
  totalFeedback: number;
  totalRecognitions: number;
}

interface PerformanceKpisProps {
  data?: DashboardKpis;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

// Five tiles: two per row on phones with the last one spanning the row, so no tile is orphaned.
const GRID =
  'grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1';

/**
 * Performance KPI strip. Every figure comes from getDashboardKpis; nothing is derived by ratio
 * (a status the system did not compute is never shown as fact). Counts stay neutral: colour is
 * reserved for real status (color.md › Best practices).
 */
export function PerformanceKpis({ data, isLoading, isError, error, onRetry }: PerformanceKpisProps) {
  const { t, locale } = useI18n();

  if (isLoading) {
    return (
      <div className={GRID} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // A permission denial (leader, employee) is not a failure: the rest of the page still works, so
  // the strip simply does not render instead of offering a retry that can never succeed.
  if (isError) {
    if (isForbiddenError(error)) return null;
    return <ErrorState size="compact" error={error} onRetry={onRetry} />;
  }

  if (!data) return null;

  return (
    <div className={GRID}>
      <KpiCard label={t.performance.kpiOkrCompletion} value={formatPercent(data.averageOkrProgress, locale)} />
      <KpiCard label={t.performance.kpiActiveOkrs} value={data.activeOkrs} />
      <KpiCard
        label={t.performance.kpiCoachingSessions}
        value={data.scheduledSessions + data.completedSessions}
        subtitle={formatMessage(t.performance.pendingThisWeek, { n: data.scheduledSessions })}
      />
      <KpiCard
        label={t.performance.kpiPendingCommitments}
        value={data.pendingCommitments}
        subtitle={formatMessage(t.performance.completedCount, { n: data.completedCommitments })}
      />
      <KpiCard
        label={t.performance.kpiRecognitions}
        value={data.totalRecognitions}
        subtitle={formatMessage(t.performance.feedbackCount, { n: data.totalFeedback })}
      />
    </div>
  );
}
