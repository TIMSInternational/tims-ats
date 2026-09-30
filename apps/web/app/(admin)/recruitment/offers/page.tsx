'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n/index';
import { OfferKpis } from './_components/offer-kpis';
import { computeOfferKpis } from './_components/offer-kpi-data';
import { OfferTable } from './_components/offer-table';
import { OfferDetailView } from './_components/offer-detail-view';

export default function OffersPage() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

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
          <OfferDetailView offerId={selectedOfferId} onBack={() => setSelectedOfferId(null)} />
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
        loading={offers.isLoading || allOffers.isLoading}
        isError={offers.isError || allOffers.isError}
        onRetry={() => {
          void offers.refetch();
          void allOffers.refetch();
        }}
      />
      <OfferTable
        items={items}
        loading={offers.isLoading}
        isError={offers.isError}
        onRetry={() => offers.refetch()}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        onSelectOffer={setSelectedOfferId}
      />
    </div>
  );
}
