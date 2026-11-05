'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n/index';
import { OfferKpis } from './_components/offer-kpis';
import { computeOfferKpis } from './_components/offer-kpi-data';
import { OfferTable } from './_components/offer-table';
import { OfferDetailView } from './_components/offer-detail-view';
import { OFFERS_PATH, OFFER_QUERY_PARAM, offerDetailHref, readOfferIdParam } from '../../../../lib/offer-deep-link';
import { MINE_PENDING_FILTER } from '../../../../lib/offer-status';
import { useCan } from '../../../../lib/permissions';

export default function OffersPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState('');
  // The open offer lives in the URL (B-27), so an email, a dashboard row or the browser Back button
  // can open or close one offer.
  const selectedOfferId = readOfferIdParam(useSearchParams()?.get(OFFER_QUERY_PARAM));
  const openOffer = (offerId: string) => router.push(offerDetailHref(offerId), { scroll: false });
  const closeOffer = () => router.push(OFFERS_PATH, { scroll: false });

  // "Pendientes de mi aprobación" (B-14): the pending offers of the list that offer.getPending says wait for
  // THIS viewer's decision (the list carries the full row, getPending knows whose turn it is).
  const canApprove = useCan()('offer', 'approve');
  const isMinePending = statusFilter === MINE_PENDING_FILTER;
  const offers = trpc.offer.list.useQuery({
    pageSize: 100,
    status: isMinePending ? 'pending_approval' : statusFilter || undefined,
  });
  const allOffers = trpc.offer.list.useQuery({ pageSize: 100 });
  const minePending = trpc.offer.getPending.useQuery(undefined, { enabled: isMinePending });

  const listed = offers.data?.items ?? [];
  const mineIds = new Set((minePending.data ?? []).map((pending) => pending.offer.id));
  const items = isMinePending ? listed.filter((offer) => mineIds.has(offer.id)) : listed;

  const kpis = useMemo(
    () => computeOfferKpis(allOffers.data?.items ?? [], allOffers.data?.total ?? 0),
    [allOffers.data],
  );

  // If an offer is selected, show detail view
  if (selectedOfferId) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <OfferDetailView offerId={selectedOfferId} onBack={closeOffer} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <OfferKpis
        activeCount={kpis.activeCount}
        acceptanceRate={kpis.acceptanceRate}
        avgSalary={kpis.avgSalary}
        avgSalaryCurrency={kpis.avgSalaryCurrency}
        pendingApprovals={kpis.pendingApprovals}
        complete={kpis.complete}
        loading={allOffers.isLoading}
        isError={allOffers.isError}
        onRetry={() => void allOffers.refetch()}
      />
      <OfferTable
        items={items}
        loading={offers.isLoading || (isMinePending && minePending.isLoading)}
        isError={offers.isError || (isMinePending && minePending.isError)}
        onRetry={() => {
          void offers.refetch();
          if (isMinePending) void minePending.refetch();
        }}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        onSelectOffer={openOffer}
        showMinePendingFilter={canApprove}
      />
    </div>
  );
}
