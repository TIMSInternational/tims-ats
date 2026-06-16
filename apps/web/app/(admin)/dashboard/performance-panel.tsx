'use client';

import { useI18n } from '../../../lib/i18n';
import { Skeleton } from '../../../components';
import { LoadError } from './load-error';

interface PerformancePanelProps {
  scheduledSessions: number;
  completedSessions: number;
  commitmentCompletionRate: number;
  activeOkrs: number;
  isLoading: boolean;
  error?: boolean;
}

export function PerformancePanel({
  scheduledSessions,
  completedSessions,
  commitmentCompletionRate,
  activeOkrs,
  isLoading,
  error,
}: PerformancePanelProps) {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;

  return (
    <div className="w-full md:flex-[35] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <span className="text-base font-semibold text-[#1F114C]">{occ.performance}</span>
      <div className="mt-4 space-y-3">
        {error ? (
          <LoadError message={occ.loadError} />
        ) : isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
        ) : (
          <>
            <StatRow label={occ.coachingSessions} value={`${completedSessions} / ${scheduledSessions}`} />
            <StatRow label={occ.commitmentRate} value={`${commitmentCompletionRate}%`} />
            <StatRow label={occ.activeOkrs} value={activeOkrs} />
          </>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[#585858]">{label}</span>
      <span className="text-sm font-semibold text-[#1F114C]">{value}</span>
    </div>
  );
}
