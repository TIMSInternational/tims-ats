'use client';

import { useId } from 'react';
import { useI18n } from '../../../lib/i18n';
import { Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatMessage } from '../../../lib/i18n/format';

interface PerformancePanelProps {
  scheduledSessions: number;
  completedSessions: number;
  commitmentCompletionRate: number;
  activeOkrs: number;
  isLoading: boolean;
  error?: boolean;
  onRetry?: () => void;
}

export function PerformancePanel({
  scheduledSessions,
  completedSessions,
  commitmentCompletionRate,
  activeOkrs,
  isLoading,
  error,
  onRetry,
}: PerformancePanelProps) {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="w-full rounded-xl bg-white p-5 shadow-card md:flex-[35]">
      <h2 id={titleId} className="text-heading font-semibold text-brand">
        {occ.performance}
      </h2>
      <div className="mt-4 space-y-3">
        {error ? (
          <LoadError message={occ.loadError} onRetry={onRetry} />
        ) : isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
        ) : (
          <>
            <StatRow
              label={occ.coachingSessions}
              value={formatMessage(occ.coachingDoneOf, { done: completedSessions, scheduled: scheduledSessions })}
            />
            <StatRow label={occ.commitmentRate} value={`${commitmentCompletionRate}%`} />
            <StatRow label={occ.activeOkrs} value={activeOkrs} />
          </>
        )}
      </div>
    </section>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-callout text-secondary">{label}</span>
      <span className="text-subheading font-semibold tabular-nums text-primary">{value}</span>
    </div>
  );
}
