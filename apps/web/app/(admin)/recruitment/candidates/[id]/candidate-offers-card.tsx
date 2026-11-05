'use client';

import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { formatDate } from '../../../../../lib/format-utils';
import { offerDetailHref } from '../../../../../lib/offer-deep-link';
import { ErrorState, Skeleton, StatusBadge } from '../../../../../components';

const STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_approval: 'bg-amber-50 text-amber-600 border border-amber-200',
  approved: 'bg-blue-50 text-blue-600 border border-blue-200',
  sent: 'bg-violet-50 text-violet-600 border border-violet-200',
  accepted: 'bg-green-50 text-green-600 border border-green-200',
  declined: 'bg-red-50 text-red-600',
  expired: 'bg-gray-100 text-gray-500',
  withdrawn: 'bg-gray-100 text-gray-500',
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
  };
  const statusMap = Object.fromEntries(
    Object.entries(STATUS_CLASSES).map(([status, cls]) => [status, { cls, label: labels[status] ?? status }]),
  );
  const items = offers.data?.items ?? [];

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.candidates.offersTitle}</h3>
      {offers.isLoading ? (
        <Skeleton className="h-12 w-full rounded-lg" />
      ) : offers.isError ? (
        <ErrorState message={t.candidates.offersLoadError} error={offers.error} onRetry={() => offers.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] py-2 text-center">{t.candidates.offersEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((offer) => (
            <li key={offer.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#F6F6F6] p-2.5">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#333] truncate">{offer.vacancy.title}</p>
                <p className="text-[10px] text-[#8B8B8B]">
                  {t.candidates.offersCreatedOn.replace('{date}', formatDate(offer.createdAt))}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={offer.status} map={statusMap} />
                <Link href={offerDetailHref(offer.id)} className="text-[11px] font-medium text-[#DD0C15] hover:underline">
                  {t.candidates.offersOpen}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
