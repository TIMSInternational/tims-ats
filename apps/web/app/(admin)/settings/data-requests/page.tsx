'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { EmptyState, Skeleton } from '../../../../components';
import { isCandidateConsentEnabled } from '../../../../lib/platform-api/candidate-consent';
import { DataRequestsTable } from './data-requests-table';

// /settings/data-requests (#312/#313): the queue of pending data-subject deletion requests (Ley 1581 de 2012).
// The C# list is dark unless the candidate-consent flag is on and needs candidate:update at org scope; the
// can() check here is UX only — the API is the real boundary (a 403 renders the same no-permission state).
export default function DataRequestsPage() {
  const { t } = useI18n();
  const m = t.dataSubjectRequests;
  const { can, isLoading } = usePermissions();

  let body: ReactNode;
  if (!isCandidateConsentEnabled())
    body = <EmptyState icon={null} message={m.unavailableTitle} description={m.unavailableMessage} />;
  else if (isLoading) body = <Skeleton className="h-24 w-full rounded-xl" />;
  else if (!can('candidate', 'update'))
    body = <EmptyState icon={null} message={m.noPermissionTitle} description={m.noPermissionMessage} />;
  else body = <DataRequestsTable />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-[#1F114C]">{m.title}</h1>
        <p className="mt-1 text-sm text-[#8B8B8B]">{m.subtitle}</p>
      </header>
      <p className="rounded-xl border border-[#EDEDED] bg-white p-4 text-xs text-[#585858]">{m.dueDateNote}</p>
      <section className="flex flex-col">{body}</section>
    </div>
  );
}
