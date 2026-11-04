'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/permissions';
import { formatDate } from '../../../lib/format-utils';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { buildApprovalInboxItems } from './my-approvals-items';

const EMPTY_ICON = <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />;

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

  const vacancies = trpc.vacancy.getPending.useQuery(undefined, { enabled: canVacancies });
  const offers = trpc.offer.getPending.useQuery(undefined, { enabled: canOffers });

  if (!canVacancies && !canOffers) return null;

  const isLoading = (canVacancies && vacancies.isLoading) || (canOffers && offers.isLoading);
  const isError = (canVacancies && vacancies.isError) || (canOffers && offers.isError);
  const items = buildApprovalInboxItems(canVacancies ? vacancies.data : undefined, canOffers ? offers.data : undefined);

  return (
    <section
      aria-labelledby="my-approvals-title"
      className={`flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${className}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 id="my-approvals-title" className="text-sm font-semibold text-[#1F114C]">
          {md.approvalsInboxTitle}
        </h2>
        {!isLoading && !isError && items.length > 0 && (
          <span
            aria-label={md.approvalsInboxCount.replace('{count}', String(items.length))}
            className="bg-[#DD0C15] text-white text-xs font-bold min-w-6 h-6 px-1.5 rounded-full flex items-center justify-center"
          >
            {items.length}
          </span>
        )}
      </div>

      {isError ? (
        <LoadError message={md.loadError} />
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
        <EmptyState icon={EMPTY_ICON} message={md.approvalsInboxEmpty} />
      ) : (
        <ul className="space-y-1 max-h-80 overflow-y-auto">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 -mx-3 hover:bg-[#F6F6F6] transition"
              >
                <span className="shrink-0 rounded-md bg-[#F0EEF6] px-2 py-0.5 text-[11px] font-medium text-[#1F114C]">
                  {item.kind === 'vacancy' ? md.approvalKindVacancy : md.approvalKindOffer}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-[#333] font-medium truncate">{item.primary}</span>
                  <span className="block text-[12px] text-[#8B8B8B] truncate">
                    {item.kind === 'offer'
                      ? item.secondary
                      : item.secondary && md.approvalCreatedBy.replace('{name}', item.secondary)}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-[#8B8B8B]">
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
