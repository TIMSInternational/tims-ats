'use client';

import { useNineBoxMyCalibrations } from '../../../lib/platform-api/ninebox';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton, StatusBadge } from '../../../components';
import { LoadError } from './load-error';

// "Mis Calibraciones" — the member's OWN 9-box calibration sessions (created or a committee member of).
// Member-scoped on the backend; never org-wide. Talent module: owns its query so NOT mounting it (pilot
// launch scope) means the calibrations request never runs.

const EMPTY_ICON = <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />;

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-amber-50 text-amber-700',
  finalized: 'bg-green-50 text-green-700',
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
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mt-6">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{ct.calibrationsTitle}</h2>
      {calibrations.isError ? (
        <LoadError message={ct.loadError} />
      ) : calibrations.isLoading ? (
        <SkeletonRows />
      ) : !calibrations.data || calibrations.data.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={ct.noCalibrations} />
      ) : (
        <div className="space-y-1">
          {calibrations.data.map((session) => (
            <div key={session.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3">
              <div className="flex items-center gap-3 min-w-0">
                <StatusBadge
                  status={session.status}
                  map={{
                    [session.status.toLowerCase()]: {
                      cls: STATUS_CLS[session.status] ?? 'bg-gray-100 text-gray-600',
                      label: statusLabel(session.status),
                    },
                  }}
                />
                <span className="text-sm text-[#333] font-medium truncate">{session.period}</span>
              </div>
              <span className="text-[13px] text-[#8B8B8B] truncate ml-3 shrink-0">
                {formatDate(session.scheduledAt)} · {session._count.members} {ct.membersCount} · {session._count.votes}{' '}
                {ct.votesCount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
