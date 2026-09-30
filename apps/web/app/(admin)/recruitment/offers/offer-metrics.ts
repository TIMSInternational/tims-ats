interface OfferSummaryItem {
  status: string;
  salary: number;
  currency: string | null;
}

export function summarizeVisibleOffers(items: readonly OfferSummaryItem[]) {
  const activeCount = items.filter((item) => ['pending_approval', 'approved', 'sent'].includes(item.status)).length;
  const acceptedItems = items.filter((item) => item.status === 'accepted');
  const sentOrResolved = items.filter((item) => ['sent', 'accepted', 'declined', 'expired'].includes(item.status)).length;
  const acceptanceRate = sentOrResolved > 0 ? Math.round((acceptedItems.length / sentOrResolved) * 100) : 0;
  const salaryCurrencies = new Set(acceptedItems.map((item) => item.currency ?? 'USD'));
  const avgSalary = acceptedItems.length > 0 && salaryCurrencies.size === 1
    ? Math.round(acceptedItems.reduce((sum, item) => sum + item.salary, 0) / acceptedItems.length)
    : null;
  const avgSalaryCurrency = salaryCurrencies.size === 1 ? [...salaryCurrencies][0] : null;
  const pendingApprovals = items.filter((item) => item.status === 'pending_approval').length;

  return { activeCount, acceptanceRate, avgSalary, avgSalaryCurrency, pendingApprovals };
}
