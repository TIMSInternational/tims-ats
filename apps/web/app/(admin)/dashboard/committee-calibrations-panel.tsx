'use client';

import { useNineBoxMyCalibrations } from '../../../lib/platform-api/ninebox';
import { useI18n } from '../../../lib/i18n';
import { useId } from 'react';
import { EmptyState, Skeleton, StatusBadge } from '../../../components';
import type { StatusTone } from '../../../components/status-badge';
import { LoadError } from './load-error';

// "Mis Calibraciones" — the member's OWN 9-box calibration sessions (created or a committee member of).
// Member-scoped on the backend; never org-wide. Talent module: owns its query so NOT mounting it (pilot
// launch scope) means the calibrations request never runs.

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  scheduled: 'info',
  in_progress: 'warning',
  finalized: 'success',
};

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export function CommitteeCalibrationsPanel() {
  const { t } = useI18n();
  const ct = t.committeeTasks;
  const calibrations = useNineBoxMyCalibrations();
  const titleId = useId();

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'draft':
        return ct.statusDraft;
      case 'scheduled':
        return ct.statusScheduled;
      case 'in_progress':
        return ct.statusInProgress;
      case 'finalized':
        return ct.statusFinalized;
      default:
        return status;
    }
  };

  const formatDate = (value: string | Date | null): string => {
    if (!value) return ct.noDate;
    return new Date(value).toLocaleDateString();
  };

  return (
    <section aria-labelledby={titleId} className="mt-6 rounded-xl bg-white p-5 shadow-card">
      <h2 id={titleId} className="mb-4 text-heading font-semibold text-brand">
        {ct.calibrationsTitle}
      </h2>
      {calibrations.isError ? (
        <LoadError message={ct.loadError} onRetry={() => calibrations.refetch()} />
      ) : calibrations.isLoading ? (
        <SkeletonRows />
      ) : !calibrations.data || calibrations.data.length === 0 ? (
        <EmptyState size="compact" message={ct.noCalibrations} />
      ) : (
        <ul className="space-y-1">
          {calibrations.data.map((session) => (
            <li
              key={session.id}
              className="-mx-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <StatusBadge tone={STATUS_TONE[session.status] ?? 'neutral'}>{statusLabel(session.status)}</StatusBadge>
                <span className="truncate text-body font-medium text-primary">{session.period}</span>
              </div>
              <span className="text-callout text-muted">
                {formatDate(session.scheduledAt)} · {session._count.members} {ct.membersCount} · {session._count.votes}{' '}
                {ct.votesCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
