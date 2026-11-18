'use client';

import { useId } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton, StatusBadge } from '../../../components';
import type { StatusTone } from '../../../components/status-badge';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';

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

const STATUS_TONE: Record<string, StatusTone> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

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
  const titleId = useId();

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
    <section aria-labelledby={titleId} className="rounded-xl bg-white p-5 shadow-card">
      <h2 id={titleId} className="mb-4 text-heading font-semibold text-brand">
        {e.commitments}
      </h2>
      {query.isError ? (
        <LoadError message={e.loadError} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState size="compact" message={e.noCommitments} />
      ) : (
        <ul className="space-y-1">
          {list.map((commitment) => (
            <li
              key={commitment.id}
              className="-mx-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2.5"
            >
              <span className="min-w-0 truncate text-body font-medium text-primary">{commitment.description}</span>
              <div className="flex shrink-0 items-center gap-3">
                <StatusBadge tone={STATUS_TONE[commitment.status] ?? 'neutral'}>
                  {statusLabel(commitment.status)}
                </StatusBadge>
                <span className="text-callout text-muted sm:w-28 sm:text-right">
                  {commitment.dueDate ? `${e.commitmentDue} ${formatDate(commitment.dueDate)}` : e.commitmentNoDue}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
