'use client';

import { useId } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton, StatusBadge } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';

const LIST_LIMIT = 50;

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      ))}
    </div>
  );
}

function senderName(fromUser: { firstName: string | null; lastName: string | null } | null): string {
  if (!fromUser) return '';
  return [fromUser.firstName, fromUser.lastName].filter(Boolean).join(' ').trim();
}

// "Reconocimientos" — OWN-scoped recognition the caller RECEIVED. The endpoint
// (performance.myRecognitions) is hard-pinned to toUserId: ctx.user.id; the row
// carries the sender's display name (Recognition has no anonymity flag). Each row
// shows the category badge, message, sender and date.
export function EmployeeRecognition() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const query = trpc.performance.myRecognitions.useQuery({ limit: LIST_LIMIT });
  const list = query.data?.recognitions ?? [];
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="rounded-xl bg-white p-5 shadow-card">
      <h2 id={titleId} className="mb-4 text-heading font-semibold text-brand">
        {e.recognition}
      </h2>
      {query.isError ? (
        <LoadError message={e.loadError} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState size="compact" message={e.noRecognitions} />
      ) : (
        <ul className="space-y-4">
          {list.map((recognition) => {
            const sender = senderName(recognition.fromUser);
            return (
              <li key={recognition.id} className="-mx-3 rounded-lg px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <StatusBadge tone="brand" icon="none">
                    {recognition.category}
                  </StatusBadge>
                  <span className="shrink-0 text-callout text-muted">{formatDate(recognition.createdAt)}</span>
                </div>
                <p className="text-body text-primary">{recognition.message}</p>
                {sender ? (
                  <p className="mt-1 text-callout text-muted">
                    {e.recognitionFrom} {sender}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
