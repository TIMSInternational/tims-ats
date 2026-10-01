'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, ErrorState } from '../../../../components';
import { classifyConsentError, useDataSubjectRequests } from '../../../../lib/platform-api/candidate-consent';
import { isRequestOverdue, requestSourceLabel, requestTypeLabel } from './data-request-labels';

const CELL_CLS = 'px-4 py-3 text-sm text-[#585858]';

/** Pending data-subject requests, oldest first (the API orders by createdAt asc, max 200 rows). */
export function DataRequestsTable() {
  const { t } = useI18n();
  const m = t.dataSubjectRequests;
  const requests = useDataSubjectRequests('pending');
  // Captured once per mount (render must stay pure); a re-mount or reload refreshes the overdue cut-off.
  const [now] = useState(() => Date.now());

  if (requests.isError) {
    if (classifyConsentError(requests.error) === 'forbidden')
      return <EmptyState icon={null} message={m.noPermissionTitle} description={m.noPermissionMessage} />;
    return <ErrorState message={m.loadError} onRetry={() => void requests.refetch()} />;
  }

  const rows = requests.data?.items ?? [];

  return (
    <DataTable
      loading={requests.isLoading}
      columns={[
        { key: 'candidate', label: m.colCandidate },
        { key: 'type', label: m.colRequestType },
        { key: 'source', label: m.colSource },
        { key: 'received', label: m.colReceived },
        { key: 'due', label: m.colDue },
      ]}
      empty={<EmptyState icon={null} message={m.emptyTitle} description={m.emptyDescription} />}
    >
      {rows.map((request) => {
        const overdue = isRequestOverdue(request.dueAt, now);
        return (
          <tr key={request.id} className="border-b border-[#EDEDED] last:border-0">
            <td className="px-4 py-3 text-sm">
              <Link
                href={`/recruitment/candidates/${request.candidateId}`}
                className="font-medium text-[#1F114C] hover:underline"
              >
                {[request.candidateFirstName, request.candidateLastName].filter(Boolean).join(' ') ||
                  m.unnamedCandidate}
              </Link>
            </td>
            <td className={CELL_CLS}>{requestTypeLabel(request.requestType, m)}</td>
            <td className={CELL_CLS}>{requestSourceLabel(request.source, m)}</td>
            <td className={CELL_CLS}>{formatDate(request.createdAt)}</td>
            <td className={CELL_CLS}>
              <span className={overdue ? 'font-medium text-red-700' : undefined}>{formatDate(request.dueAt)}</span>
              {overdue && (
                <span className="ml-2 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                  {m.overdue}
                </span>
              )}
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
