// RH-26: summary figures for the vacancy list's KPI row, derived only from vacancy.getDashboardKpis.
// `totalOpen` already counts approved + published vacancies, so `totalPublished` must NOT be added
// to the total again (it was, which double-counted every published vacancy).
export interface VacancyStatusCounts {
  totalOpen: number;
  totalDraft: number;
  totalPendingApproval: number;
  totalPublished: number;
  totalClosed: number;
}

export function summarizeVacancyKpis(k: VacancyStatusCounts): { total: number; fillRatePct: number } {
  const total = k.totalOpen + k.totalDraft + k.totalPendingApproval + k.totalClosed;
  const fillRatePct = total > 0 ? Math.round((k.totalClosed / total) * 100) : 0;
  return { total, fillRatePct };
}
