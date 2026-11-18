'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/permissions';
import { formatDate } from '../../../lib/format-utils';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { buildApprovalInboxItems } from './my-approvals-items';

interface MyApprovalsCardProps {
  /** Extra classes for the card root (spacing in the host dashboard). */
  className?: string;
}

/**
 * "Pendientes de mi aprobación" (Pilot UX audit B-01): every vacancy and offer whose approval chain
 * has a pending step for the viewer, oldest first, each row deep-linked to the item itself. Rendered
 * only for users who can approve vacancies or offers; each half queries only when its grant is held.
 */
export function MyApprovalsCard({ className = '' }: MyApprovalsCardProps) {
  const { t } = useI18n();
  const md = t.managerDashboard;
  const { can, isLoading: permissionsLoading } = usePermissions();
  const canVacancies = !permissionsLoading && can('vacancy', 'approve');
  const canOffers = !permissionsLoading && can('offer', 'approve');

  // Decisions happen on the vacancy and offer pages: refetch whenever the dashboard mounts so an item
  // decided a moment ago never lingers here for the default 5-minute staleTime.
  const vacancies = trpc.vacancy.getPending.useQuery(undefined, { enabled: canVacancies, refetchOnMount: 'always' });
  const offers = trpc.offer.getPending.useQuery(undefined, { enabled: canOffers, refetchOnMount: 'always' });

  if (!canVacancies && !canOffers) return null;

  const isLoading = (canVacancies && vacancies.isLoading) || (canOffers && offers.isLoading);
  const isError = (canVacancies && vacancies.isError) || (canOffers && offers.isError);
  const items = buildApprovalInboxItems(canVacancies ? vacancies.data : undefined, canOffers ? offers.data : undefined);

  return (
    <section aria-labelledby="my-approvals-title" className={`flex-1 rounded-xl bg-white p-5 shadow-card ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 id="my-approvals-title" className="text-subheading font-semibold text-brand">
          {md.approvalsInboxTitle}
        </h2>
        {!isLoading && !isError && items.length > 0 && (
          <span
            role="status"
            aria-label={md.approvalsInboxCount.replace('{count}', String(items.length))}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-red px-1.5 text-caption font-semibold tabular-nums text-white"
          >
            {items.length}
          </span>
        )}
      </div>

      {isError ? (
        <LoadError
          message={md.loadError}
          onRetry={() => {
            if (vacancies.isError) vacancies.refetch();
            if (offers.isError) offers.refetch();
          }}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState size="compact" message={md.approvalsInboxEmpty} />
      ) : (
        <ul className="space-y-1 max-h-80 overflow-y-auto">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="-mx-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface"
              >
                <span className="shrink-0 rounded-md bg-brand-tint px-2 py-0.5 text-caption font-medium text-brand">
                  {item.kind === 'vacancy' ? md.approvalKindVacancy : md.approvalKindOffer}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-primary">{item.primary}</span>
                  <span className="block truncate text-callout text-muted">
                    {item.kind === 'offer'
                      ? item.secondary
                      : item.secondary && md.approvalCreatedBy.replace('{name}', item.secondary)}
                  </span>
                </span>
                <span className="shrink-0 text-callout text-muted">
                  {md.approvalRequestedOn.replace('{date}', formatDate(item.requestedAt))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
