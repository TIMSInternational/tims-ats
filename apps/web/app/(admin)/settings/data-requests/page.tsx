'use client';

import type { ReactNode } from 'react';
import { ACTIVE_APPLICATION_CONSENT_VARIANT } from '@tims/shared';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { EmptyState, PageHeader, Skeleton } from '../../../../components';
import { isCandidateConsentEnabled } from '../../../../lib/platform-api/candidate-consent';
import { DataRequestsTable } from './data-requests-table';
import { StateIcon } from './state-icon';

// /settings/data-requests (#312/#313): the queue of pending data-subject deletion requests (Ley 1581 de 2012).
// The C# list is dark unless the candidate-consent flag is on and needs candidate:update at org scope; the
// can() check here is UX only — the API is the real boundary (a 403 renders the same no-permission state).
export default function DataRequestsPage() {
  const { t } = useI18n();
  const m = t.dataSubjectRequests;
  const { can, isLoading } = usePermissions();

  let body: ReactNode;
  if (!isCandidateConsentEnabled())
    body = (
      <EmptyState icon={<StateIcon kind="info" />} message={m.unavailableTitle} description={m.unavailableMessage} />
    );
  else if (isLoading) body = <Skeleton className="h-24 w-full rounded-xl" />;
  else if (!can('candidate', 'update'))
    body = (
      <EmptyState icon={<StateIcon kind="lock" />} message={m.noPermissionTitle} description={m.noPermissionMessage} />
    );
  else body = <DataRequestsTable />;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* The Ley N.° 8968 wording follows the candidate notice's variant (off by default). */}
      <PageHeader
        title={m.title}
        description={
          ACTIVE_APPLICATION_CONSENT_VARIANT === 'ley8968' ? t.dataSubjectRequestsLey8968.subtitle : m.subtitle
        }
      />
      <section className="flex flex-1 flex-col overflow-y-auto px-4 py-5 md:px-6 md:py-6">{body}</section>
    </div>
  );
}
