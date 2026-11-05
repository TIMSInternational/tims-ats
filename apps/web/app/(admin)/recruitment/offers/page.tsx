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

export default function OffersPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState('');
  // The open offer lives in the URL (B-27), so an email, a dashboard row or the browser Back button
  // can open or close one offer.
  const selectedOfferId = readOfferIdParam(useSearchParams()?.get(OFFER_QUERY_PARAM));
  const openOffer = (offerId: string) => router.push(offerDetailHref(offerId), { scroll: false });
  const closeOffer = () => router.push(OFFERS_PATH, { scroll: false });

  const offers = trpc.offer.list.useQuery({
    pageSize: 100,
    status: statusFilter || undefined,
  });
  const allOffers = trpc.offer.list.useQuery({ pageSize: 100 });

  const items = offers.data?.items ?? [];

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
        loading={offers.isLoading}
        isError={offers.isError}
        onRetry={() => offers.refetch()}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        onSelectOffer={openOffer}
      />
    </div>
  );
}
