// Status tones for the onboarding table (onboarding-table.tsx). Labels come from i18n
// (onboarding.phase*, onboarding.risk*, myOnboarding.labels.statuses.completed); these maps hold tones only.
// Colour marks real status only (color.md › Best practices): a plan is red only when it has an overdue task.
import type { StatusTone } from '../../../../components';

export const PHASE_TONE: Record<string, StatusTone> = {
  day1_30: 'brand',
  day31_60: 'warning',
  day61_90: 'neutral',
  completed: 'success',
};

export type RiskLevel = 'high' | 'medium' | 'low';

export function getRiskLevel(score: number): RiskLevel {
  if (score > 0.3) return 'high';
  if (score > 0.15) return 'medium';
  return 'low';
}

export const RISK_TONE: Record<RiskLevel, StatusTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

/** Progress bar tone and % text: neutral, or danger only when the plan has an overdue task. */
export function getProgressColor(hasOverdue: boolean): { tone: 'brand' | 'danger'; text: string } {
  return hasOverdue ? { tone: 'danger', text: 'text-danger font-medium' } : { tone: 'brand', text: 'text-secondary' };
}

/** The "done/total" fraction: secondary text, danger only when the plan has an overdue task. */
export function fractionColor(hasOverdue: boolean): string {
  return hasOverdue ? 'text-danger font-medium' : 'text-secondary';
}
