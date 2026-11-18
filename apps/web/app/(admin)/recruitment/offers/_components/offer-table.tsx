'use client';

import Link from 'next/link';
import { DataTable, EmptyState, StatusBadge, CandidateAvatar, ErrorState } from '../../../../../components';
import type { StatusMapEntry } from '../../../../../components/status-badge';
import { OFFER_STATUS_TONES } from './offer-detail-view.helpers';
import { buttonClasses } from '../../../../../components/button-styles';
import { selectClasses } from '../../../../../components/field-styles';
import { offerDetailHref } from '../../../../../lib/offer-deep-link';
import { ApprovalDots } from './approval-dots';
import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { formatMoneyCode } from '../../../../../lib/offer-salary';
import {
  MINE_PENDING_FILTER,
  OFFER_FILTER_STATUSES,
  offerStatusLabel,
  type OfferStatusLabels,
} from '../../../../../lib/offer-status';
import { displayOfferStatus } from '@tims/shared';
import { useTenantLocale } from '../../../../../lib/tenant-locale-context';

function statusMap(labels: OfferStatusLabels): Record<string, StatusMapEntry> {
  return Object.fromEntries(
    Object.entries(OFFER_STATUS_TONES).map(([status, tone]) => [status, { tone, label: offerStatusLabel(status, labels) }]),
  );
}

interface OfferItem {
  id: string;
  salary: number;
  currency: string;
  status: string;
  sentAt: Date | string | null;
  expiresAt: Date | string | null;
  candidate: { id: string; firstName: string; lastName: string; email: string; avatar: string | null };
  vacancy: { id: string; title: string };
  approvals: Array<{ status: string }>;
}

interface OfferTableProps {
  items: OfferItem[];
  loading: boolean;
  isError: boolean;
  onRetry?: () => void;
  statusFilter: string;
  onStatusChange: (status: string) => void;
  onSelectOffer: (id: string) => void;
  /** Offer "Pendientes de mi aprobación" in the filter (viewers who can approve offers). */
  showMinePendingFilter?: boolean;
}

export function OfferTable({
  items,
  loading,
  isError,
  onRetry,
  statusFilter,
  onStatusChange,
  onSelectOffer,
  showMinePendingFilter = false,
}: OfferTableProps) {
  const { t } = useI18n();
  const { intlLocale } = useTenantLocale();
  const map = statusMap(t.offers);

  const columns = [
    { key: 'candidate', label: t.offers.colCandidate },
    { key: 'vacancy', label: t.offers.colVacancy },
    { key: 'salary', label: t.offers.colSalary },
    { key: 'status', label: t.offers.colStatus },
    { key: 'approvals', label: t.offers.colApprovals },
    { key: 'sent', label: t.offers.colSent },
    { key: 'actions', label: t.offers.colActions, align: 'right' as const },
  ];

  const name = (offer: OfferItem) => `${offer.candidate.firstName} ${offer.candidate.lastName}`;
  // A real link per row (lists-and-tables.md › Best practices); the row click stays as a convenience.
  const nameLink = (offer: OfferItem) => (
    <Link
      href={offerDetailHref(offer.id)}
      scroll={false}
      onClick={(e) => e.stopPropagation()}
      className="text-body font-medium text-primary hover:underline"
    >
      {name(offer)}
    </Link>
  );
  const salary = (offer: OfferItem) => `${formatMoneyCode(offer.salary, offer.currency, intlLocale)} / ${t.offers.perYear}`;

  // Phones: a stacked list instead of the seven-column table (foundation-spec.md §7).
  const mobileList = items.map((offer) => (
    <div key={offer.id} className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {nameLink(offer)}
          <p className="truncate text-callout text-secondary">{offer.vacancy.title}</p>
        </div>
        <StatusBadge status={displayOfferStatus(offer)} map={map} />
      </div>
      <div className="flex items-center justify-between gap-3 text-callout text-secondary tabular-nums">
        <span>{salary(offer)}</span>
        <ApprovalDots approvals={offer.approvals} />
      </div>
    </div>
  ));

  return (
    <>
      <div className="mb-4 flex flex-shrink-0 flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          aria-label={t.offers.filterStatusLabel}
          className={selectClasses('md', 'sm:w-auto max-w-full')}
        >
          <option value="">{t.offers.allStatuses}</option>
          {showMinePendingFilter && <option value={MINE_PENDING_FILTER}>{t.offers.filterMinePending}</option>}
          {OFFER_FILTER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {offerStatusLabel(status, t.offers)}
            </option>
          ))}
        </select>
        {statusFilter && (
          <button type="button" onClick={() => onStatusChange('')} className={buttonClasses({ variant: 'tertiary' })}>
            {t.subscriptions.clearFilters}
          </button>
        )}
      </div>

      {isError ? (
        <ErrorState onRetry={onRetry} />
      ) : (
      <DataTable
        columns={columns}
        loading={loading}
        skeletonRows={8}
        label={t.offers.title}
        mobileList={items.length > 0 ? mobileList : undefined}
        empty={
          <EmptyState
            icon={
              <svg className="size-8 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            }
            title={t.offers.noOffers}
            description={t.offers.noOffersDesc}
            secondaryAction={statusFilter ? { label: t.common.clearFilters, onClick: () => onStatusChange('') } : undefined}
          />
        }
      >
        {items.map((offer) => (
          <tr
            key={offer.id}
            className="cursor-pointer border-b border-border transition-colors hover:bg-surface-hover"
            onClick={() => onSelectOffer(offer.id)}
          >
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <CandidateAvatar
                  firstName={offer.candidate.firstName}
                  lastName={offer.candidate.lastName}
                  avatar={offer.candidate.avatar}
                  size="sm"
                  decorative
                />
                <div className="min-w-0">
                  {nameLink(offer)}
                  <p className="text-caption text-muted">{offer.candidate.email}</p>
                </div>
              </div>
            </td>
            <td className="px-4 py-3">
              <span className="text-callout text-secondary">{offer.vacancy.title}</span>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span className="text-body font-medium text-primary tabular-nums">{salary(offer)}</span>
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={displayOfferStatus(offer)} map={map} />
            </td>
            <td className="px-4 py-3">
              <ApprovalDots approvals={offer.approvals} />
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span className="text-callout text-secondary tabular-nums">{offer.sentAt ? formatDate(offer.sentAt) : '—'}</span>
            </td>
            <td className="px-4 py-3 text-right">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectOffer(offer.id);
                }}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                {t.offers.viewDetail}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
      )}
    </>
  );
}
