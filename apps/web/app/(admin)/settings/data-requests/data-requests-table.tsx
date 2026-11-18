'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, ErrorState, StatusBadge } from '../../../../components';
import { classifyConsentError, useDataSubjectRequests } from '../../../../lib/platform-api/candidate-consent';
import { isRequestOverdue, requestSourceLabel, requestTypeLabel } from './data-request-labels';
import { StateIcon } from './state-icon';

const CELL_CLS = 'px-4 py-3 text-body text-secondary';
const LINK_CLS = 'font-medium text-brand underline-offset-2 hover:underline';

/** Pending data-subject requests, oldest first (the API orders by createdAt asc, max 200 rows). */
export function DataRequestsTable() {
  const { t } = useI18n();
  const m = t.dataSubjectRequests;
  const requests = useDataSubjectRequests('pending');
  // Captured once per mount (render must stay pure); a re-mount or reload refreshes the overdue cut-off.
  const [now] = useState(() => Date.now());

  if (requests.isError) {
    if (classifyConsentError(requests.error) === 'forbidden')
      return (
        <EmptyState
          icon={<StateIcon kind="lock" />}
          message={m.noPermissionTitle}
          description={m.noPermissionMessage}
        />
      );
    return <ErrorState message={m.loadError} onRetry={() => void requests.refetch()} error={requests.error} />;
  }

  const rows = requests.data?.items ?? [];
  const nameOf = (r: (typeof rows)[number]) =>
    [r.candidateFirstName, r.candidateLastName].filter(Boolean).join(' ') || m.unnamedCandidate;
  const overdueChip = <StatusBadge tone="danger">{m.overdue}</StatusBadge>;

  const mobileList = (
    <ul className="divide-y divide-border">
      {rows.map((request) => {
        const overdue = isRequestOverdue(request.dueAt, now);
        return (
          <li key={request.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link href={`/recruitment/candidates/${request.candidateId}`} className={`text-body ${LINK_CLS}`}>
                {nameOf(request)}
              </Link>
              <p className="text-callout text-secondary">
                {requestTypeLabel(request.requestType, m)} · {requestSourceLabel(request.source, m)}
              </p>
              <p className="text-callout text-secondary">
                {formatMessage(m.dueOn, { date: formatDate(request.dueAt) })}
              </p>
            </div>
            {overdue && overdueChip}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        loading={requests.isLoading}
        label={m.title}
        mobileList={rows.length > 0 ? mobileList : undefined}
        columns={[
          { key: 'candidate', label: m.colCandidate },
          { key: 'type', label: m.colRequestType },
          { key: 'source', label: m.colSource },
          { key: 'received', label: m.colReceived },
          { key: 'due', label: m.colDue },
        ]}
        empty={<EmptyState message={m.emptyTitle} description={m.emptyDescription} />}
      >
        {rows.map((request) => {
          const overdue = isRequestOverdue(request.dueAt, now);
          return (
            <tr key={request.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 text-body">
                <Link href={`/recruitment/candidates/${request.candidateId}`} className={LINK_CLS}>
                  {nameOf(request)}
                </Link>
              </td>
              <td className={CELL_CLS}>{requestTypeLabel(request.requestType, m)}</td>
              <td className={CELL_CLS}>{requestSourceLabel(request.source, m)}</td>
              <td className={`${CELL_CLS} tabular-nums`}>{formatDate(request.createdAt)}</td>
              <td className={`${CELL_CLS} tabular-nums`}>
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className={overdue ? 'font-medium text-danger' : undefined}>{formatDate(request.dueAt)}</span>
                  {overdue && overdueChip}
                </span>
              </td>
            </tr>
          );
        })}
      </DataTable>
      {rows.length > 0 && <p className="max-w-prose text-callout text-secondary">{m.dueDateNote}</p>}
    </div>
  );
}
