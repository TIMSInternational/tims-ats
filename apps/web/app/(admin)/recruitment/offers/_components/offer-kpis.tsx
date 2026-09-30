'use client';

import { KpiCard, KpiCardSkeleton, ErrorState } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n/index';
import { formatCurrency } from '../../../../../lib/format-utils';

interface OfferKpisProps {
  activeCount: number | null;
  acceptanceRate: number | null;
  avgSalary: number | null;
  avgSalaryCurrency: string | null;
  pendingApprovals: number | null;
  complete: boolean;
  loading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

export function OfferKpis({
  activeCount,
  acceptanceRate,
  avgSalary,
  avgSalaryCurrency,
  pendingApprovals,
  complete,
  loading,
  isError,
  onRetry,
}: OfferKpisProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <KpiCard
        label={t.offers.kpiActive}
        value={activeCount ?? 'N/D'}
        subtitle={complete ? t.offers.activeOffers : t.offers.kpiIncomplete}
        icon={
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        }
        iconBg="bg-[#1F114C]"
      />
      <KpiCard
        label={t.offers.kpiAcceptance}
        value={acceptanceRate === null ? 'N/D' : `${acceptanceRate}%`}
        subtitle={complete ? t.offers.ofSentOrResolved : t.offers.kpiIncomplete}
        icon={
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        }
        iconBg="bg-green-500"
        valueColor="text-green-600"
      />
      <KpiCard
        label={t.offers.kpiAvgSalary}
        value={avgSalary === null ? 'N/D' : formatCurrency(avgSalary, avgSalaryCurrency ?? 'USD')}
        subtitle={complete ? t.offers.avgOfAccepted : t.offers.kpiIncomplete}
        icon={
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        iconBg="bg-blue-500"
      />
      <KpiCard
        label={t.offers.kpiPending}
        value={pendingApprovals ?? 'N/D'}
        subtitle={complete ? t.offers.pendingYourApproval : t.offers.kpiIncomplete}
        icon={
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        iconBg="bg-amber-500"
        highlight={pendingApprovals !== null && pendingApprovals > 0}
      />
    </div>
  );
}
