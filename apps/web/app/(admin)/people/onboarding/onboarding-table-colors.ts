// Row colors for the onboarding table (onboarding-table.tsx). Labels come from i18n
// (onboarding.phase*, myOnboarding.labels.statuses.completed); these maps hold colors only.

export const PHASE_BADGE: Record<string, { bg: string; text: string }> = {
  day1_30: { bg: 'bg-green-50', text: 'text-green-600' },
  day31_60: { bg: 'bg-amber-50', text: 'text-amber-600' },
  day61_90: { bg: 'bg-purple-50', text: 'text-[#5C4B99]' },
  completed: { bg: 'bg-blue-50', text: 'text-blue-600' },
};

export function getRiskDot(score: number): string {
  if (score > 0.3) return 'bg-[#DD0C15] animate-pulse';
  if (score > 0.15) return 'bg-amber-500';
  return 'bg-green-500';
}

export function getProgressColor(risk: number): { bar: string; text: string } {
  if (risk > 0.3) return { bar: 'bg-[#DD0C15]', text: 'text-[#DD0C15] font-medium' };
  if (risk > 0.15) return { bar: 'bg-amber-500', text: 'text-amber-600' };
  return { bar: 'bg-green-500', text: 'text-[#585858]' };
}

export function fractionColor(done: number, total: number, risk: number): string {
  if (total === 0) return 'text-[#585858]';
  const ratio = done / total;
  if (risk > 0.3 && ratio < 0.5) return 'text-[#DD0C15] font-medium';
  if (ratio >= 0.8) return 'text-green-600 font-medium';
  if (ratio >= 0.5) return 'text-amber-600 font-medium';
  return 'text-[#DD0C15] font-medium';
}
