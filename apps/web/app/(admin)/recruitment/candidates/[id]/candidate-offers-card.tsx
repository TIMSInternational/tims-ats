'use client';

import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { formatDate } from '../../../../../lib/format-utils';
import { offerDetailHref } from '../../../../../lib/offer-deep-link';
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  TEXT_LINK_CLASSES,
  type StatusTone,
} from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';

// Status tones (foundation-spec.md §12): outcomes carry a word and an icon, never colour alone.
const STATUS_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  sent: 'brand',
  accepted: 'success',
  converted: 'success',
  declined: 'danger',
  expired: 'neutral',
  withdrawn: 'neutral',
};

/** The candidate's offers with their status, each opening the offer itself (A-15). Needs offer:read. */
export function CandidateOffersCard({ candidateId }: { candidateId: string }) {
  const can = useCan();
  if (!can('offer', 'read')) return null;
  return <OffersCardBody candidateId={candidateId} />;
}

function OffersCardBody({ candidateId }: { candidateId: string }) {
  const { t } = useI18n();
  const offers = trpc.offer.list.useQuery({ candidateId, pageSize: 20 });
  const o = t.offers;
  const labels: Record<string, string> = {
    draft: o.statusDraft,
    pending_approval: o.statusPending,
    approved: o.statusApproved,
    sent: o.statusSent,
    accepted: o.statusAccepted,
    declined: o.statusDeclined,
    expired: o.statusExpired,
    withdrawn: o.statusWithdrawn,
    converted: o.statusConverted,
  };
  const statusMap = Object.fromEntries(
    Object.entries(STATUS_TONES).map(([status, tone]) => [status, { tone, label: labels[status] ?? status }]),
  );
  const items = offers.data?.items ?? [];

  return (
    <section className={CARD}>
      <h2 className={`${CARD_TITLE} mb-3`}>{t.candidates.offersTitle}</h2>
      {offers.isLoading ? (
        <Skeleton className="h-12 w-full rounded-lg" />
      ) : offers.isError ? (
        <ErrorState
          size="compact"
          message={t.candidates.offersLoadError}
          error={offers.error}
          onRetry={() => offers.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState size="compact" title={t.candidates.offersEmpty} />
      ) : (
        <ul className="space-y-2">
          {items.map((offer) => (
            <li
              key={offer.id}
              className="flex flex-col gap-2 rounded-lg bg-surface p-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-primary">{offer.vacancy.title}</p>
                <p className="text-caption text-muted">
                  {t.candidates.offersCreatedOn.replace('{date}', formatDate(offer.createdAt))}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <StatusBadge status={offer.status} map={statusMap} />
                <Link href={offerDetailHref(offer.id)} className={`${TEXT_LINK_CLASSES} text-callout`}>
                  {t.candidates.offersOpen}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
