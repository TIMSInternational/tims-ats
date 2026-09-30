type OfferForKpi = {
  status: string;
  salary: number;
  currency: string | null;
};

export type OfferKpiData = {
  activeCount: number | null;
  acceptanceRate: number | null;
  avgSalary: number | null;
  avgSalaryCurrency: string | null;
  pendingApprovals: number | null;
  complete: boolean;
};

/** Only present organization-wide metrics when the entire offer list was loaded. */
export function computeOfferKpis(items: readonly OfferForKpi[], total: number): OfferKpiData {
  if (items.length !== total) {
    return {
      activeCount: null,
      acceptanceRate: null,
      avgSalary: null,
      avgSalaryCurrency: null,
      pendingApprovals: null,
      complete: false,
    };
  }

  const accepted = items.filter((offer) => offer.status === 'accepted');
  const sentOrResolved = items.filter((offer) => ['sent', 'accepted', 'declined', 'expired'].includes(offer.status));
  const acceptedCurrencies = new Set(accepted.map((offer) => offer.currency ?? 'USD'));
  const avgSalaryCurrency = acceptedCurrencies.size === 1 ? [...acceptedCurrencies][0] : null;

  return {
    activeCount: items.filter((offer) => ['pending_approval', 'approved', 'sent'].includes(offer.status)).length,
    acceptanceRate: sentOrResolved.length > 0 ? Math.round((accepted.length / sentOrResolved.length) * 100) : null,
    avgSalary:
      accepted.length > 0 && avgSalaryCurrency !== null
        ? Math.round(accepted.reduce((sum, offer) => sum + offer.salary, 0) / accepted.length)
        : null,
    avgSalaryCurrency,
    pendingApprovals: items.filter((offer) => offer.status === 'pending_approval').length,
    complete: true,
  };
}
