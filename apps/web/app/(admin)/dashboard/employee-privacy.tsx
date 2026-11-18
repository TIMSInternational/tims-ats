'use client';

import { useId } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton, StatusBadge } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

// "Privacidad" — OWN-scoped, READ-ONLY consent ledger. Lists the caller's consent
// types with active/withdrawn status + text version. Grant/withdraw mutations are
// a follow-up slice.
export function EmployeePrivacy() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const consents = trpc.consent.myConsents.useQuery();
  const list = consents.data ?? [];
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="rounded-xl bg-white p-5 shadow-card">
      <h2 id={titleId} className="mb-4 text-heading font-semibold text-brand">
        {e.privacy}
      </h2>
      {consents.isError ? (
        <LoadError message={e.loadError} onRetry={() => consents.refetch()} />
      ) : consents.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState size="compact" message={e.noConsents} />
      ) : (
        <ul className="space-y-1">
          {list.map((consent) => {
            const withdrawn = consent.withdrawnAt != null;
            return (
              <li
                key={consent.id}
                className="-mx-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2.5"
              >
                <div className="min-w-0">
                  <span className="block truncate text-body font-medium text-primary">{consent.consentType}</span>
                  <span className="text-callout text-muted">
                    {e.consentVersion} {consent.textVersion} ·{' '}
                    {withdrawn
                      ? `${e.consentWithdrawnOn} ${formatDate(consent.withdrawnAt)}`
                      : `${e.consentAgreedOn} ${formatDate(consent.agreedAt)}`}
                  </span>
                </div>
                <StatusBadge tone={withdrawn ? 'neutral' : 'success'}>
                  {withdrawn ? e.consentWithdrawn : e.consentActive}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
