'use client';

import { useI18n } from '../lib/i18n';
import { formatMessage } from '../lib/i18n/format';
import { fitBand, type FitBand } from '../lib/pipeline-fit';

interface FitScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  /** Show the band word ("Alta", "Media", "Baja") beside the circle, so the band never rests on colour alone. */
  showBand?: boolean;
}

const SIZES = {
  sm: 'size-8 text-caption',
  md: 'size-10 text-callout',
  lg: 'size-12 text-subheading',
};

// Status token pairs (each ≥ 4.79:1); the same bands as the header, pipeline and filters (A-23).
const BAND_CLASSES: Record<FitBand, string> = {
  high: 'bg-success-bg text-success border-success/40',
  medium: 'bg-warning-bg text-warning border-warning/40',
  low: 'bg-danger-bg text-danger border-danger/40',
};

export function FitScoreBadge({ score, size = 'md', showBand = false }: FitScoreBadgeProps) {
  const { t } = useI18n();
  const band = fitBand(score);
  const copy = t.fitScoreBadge;
  const bandWord = band === 'high' ? copy.high : band === 'medium' ? copy.medium : copy.low;
  const bandLabel = band === 'high' ? copy.bandHigh : band === 'medium' ? copy.bandMedium : copy.bandLow;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="img"
        aria-label={formatMessage(copy.label, { score, band: bandWord })}
        className={`${SIZES[size]} inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums ${BAND_CLASSES[band]}`}
      >
        <span aria-hidden="true">{score}</span>
      </span>
      {showBand && (
        <span aria-hidden="true" className="text-callout text-secondary">
          {bandLabel}
        </span>
      )}
    </span>
  );
}
