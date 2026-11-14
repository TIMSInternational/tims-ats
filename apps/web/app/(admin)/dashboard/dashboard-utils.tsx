// Dashboard utility functions, types, and constants

import type { StatusTone } from '../../../components/status-badge';
import { intlLocale } from '../../../lib/format-utils';

type Locale = 'ES' | 'EN';

/**
 * Plans are one navy-ramp series (chart tokens, dark → light). Green / amber / red mean health only, so a
 * plan colour is never read as "healthy" or "at risk" (color.md › Best practices).
 */
export const PLAN_COLORS: Record<string, string> = {
  enterprise: 'var(--color-chart-1)',
  professional: 'var(--color-chart-3)',
  starter: 'var(--color-chart-4)',
  trial: 'var(--color-chart-5)',
};

export const PLAN_FALLBACK_COLOR = 'var(--color-chart-grid)';

/** The same ramp as legend swatch classes (HTML legends, no inline style). */
export const PLAN_SWATCH_CLASSES: Record<string, string> = {
  enterprise: 'bg-chart-1',
  professional: 'bg-chart-3',
  starter: 'bg-chart-4',
  trial: 'bg-chart-5',
};

/** Shortens a long axis label; the full name stays in the tooltip and the text alternative. */
export function truncateLabel(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}

/** Plan chips are neutral: the plan name carries the meaning. */
export const PLAN_BG_CLASSES: Record<string, string> = {
  trial: 'bg-surface text-secondary',
  starter: 'bg-surface text-secondary',
  professional: 'bg-surface text-secondary',
  enterprise: 'bg-surface text-secondary',
};

export const PLAN_CHIP_FALLBACK = 'bg-surface text-secondary';

// Plan names are product names: the same in both locales.
export const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

/** Health → StatusBadge tone and the i18n key (t.dashboard.*) of its word. */
export const HEALTH_CONFIG: Record<string, { tone: StatusTone; labelKey: 'healthy' | 'yellow' | 'red' }> = {
  healthy: { tone: 'success', labelKey: 'healthy' },
  at_risk: { tone: 'warning', labelKey: 'yellow' },
  critical: { tone: 'danger', labelKey: 'red' },
};

export const SEVERITY_CONFIG: Record<string, { tone: StatusTone }> = {
  critical: { tone: 'danger' },
  warning: { tone: 'warning' },
  info: { tone: 'info' },
};

/** USD money in the UI locale; `compact` → "93,5 mil US$" / "$93.5K" for chart axes and tiles. */
export function formatCurrency(value: number, locale: Locale, compact?: boolean): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

/** Change against the previous value: a signed percent, its tone, and its direction (none at 0). */
export function trendArrow(
  current: number,
  previous: number,
): { label: string; color: string; direction: 'up' | 'down' | 'none' } {
  if (previous === 0) return { label: '+0%', color: 'text-muted', direction: 'none' };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return { label: `+${pct}%`, color: 'text-success', direction: 'up' };
  if (pct < 0) return { label: `${pct}%`, color: 'text-danger', direction: 'down' };
  return { label: '+0%', color: 'text-muted', direction: 'none' };
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`animate-pulse rounded bg-gray-200 motion-reduce:animate-none ${className}`} />
  );
}
