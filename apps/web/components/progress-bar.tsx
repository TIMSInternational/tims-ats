'use client';

import type { StatusTone } from './status-badge';

type BarTone = Extract<StatusTone, 'brand' | 'success' | 'warning' | 'danger' | 'info'>;

const FILL: Record<BarTone, string> = {
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

// Fill widths in 5% steps, so the bar needs no inline style.
const WIDTHS = [
  'w-0',
  'w-[5%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-full',
] as const;

interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible name ("Progreso del onboarding"). Shown above the bar unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  /** Text after the label, e.g. "3 de 8" or "72%". Also the aria-valuetext. */
  valueText?: string;
  /** progress = a task advancing (role=progressbar); meter = a measured score (role=meter). */
  kind?: 'progress' | 'meter';
  tone?: BarTone;
  /** No data yet: a dashed empty track instead of a 0% bar. */
  noData?: boolean;
  className?: string;
}

/** A determinate bar (progress-indicators.md: "When possible, use a determinate progress indicator"). */
export function ProgressBar({
  value,
  max = 100,
  label,
  hideLabel = false,
  valueText,
  kind = 'progress',
  tone = 'brand',
  noData = false,
  className = '',
}: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const width = WIDTHS[Math.round(ratio * 20)] ?? 'w-0';
  return (
    <div className={className}>
      {!hideLabel && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-callout">
          <span className="text-secondary">{label}</span>
          {valueText && <span className="font-medium tabular-nums text-primary">{valueText}</span>}
        </div>
      )}
      <div
        role={kind === 'meter' ? 'meter' : 'progressbar'}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={noData ? undefined : value}
        aria-valuetext={valueText}
        className={`h-2 w-full overflow-hidden rounded-full ${noData ? 'border border-dashed border-field-border' : 'bg-surface'}`}
      >
        {!noData && (
          <div className={`h-full rounded-full transition-[width] duration-200 ease-out ${FILL[tone]} ${width}`} />
        )}
      </div>
    </div>
  );
}
