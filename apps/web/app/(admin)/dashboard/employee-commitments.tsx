'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

const LIST_LIMIT = 50;

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-[#FFF4E5] text-[#B45309]',
  in_progress: 'bg-[#E5F0FF] text-[#1D4ED8]',
  completed: 'bg-[#E6F6EC] text-[#15803D]',
  cancelled: 'bg-[#F0F0F0] text-[#6B7280]',
};

function StatusBadge({ status, label }: { status: string; label: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${style}`}
    >
      {label}
    </span>
  );
}

// "Mis Compromisos" — OWN-scoped coaching commitments. The endpoint
// (performance.myCommitments) resolves the subject through scopeWhereFor
// ('commitment') AND-composed with organizationId, so the caller sees only
// commitments where they are the employee or the creator. Each row shows the
// description, a status badge and the due date.
export function EmployeeCommitments() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const query = trpc.performance.myCommitments.useQuery({ limit: LIST_LIMIT });
  const list = query.data?.commitments ?? [];

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'pending':
        return e.commitmentStatusPending;
      case 'in_progress':
        return e.commitmentStatusInProgress;
      case 'completed':
        return e.commitmentStatusCompleted;
      case 'cancelled':
        return e.commitmentStatusCancelled;
      default:
        return status;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-8">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{e.commitments}</h2>
      {query.isError ? (
        <LoadError message={e.loadError} />
      ) : query.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={e.noCommitments} />
      ) : (
        <div className="space-y-1">
          {list.map((commitment) => (
            <div
              key={commitment.id}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 -mx-3"
            >
              <span className="text-sm text-[#333] font-medium min-w-0 truncate">
                {commitment.description}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                <StatusBadge status={commitment.status} label={statusLabel(commitment.status)} />
                <span className="text-[13px] text-[#8B8B8B] w-28 text-right">
                  {commitment.dueDate
                    ? `${e.commitmentDue} ${formatDate(commitment.dueDate)}`
                    : e.commitmentNoDue}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
