'use client';

import Link from 'next/link';
import { STATUS_TONE_CLASSES, type StatusTone } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { fitBand, type FitBand } from '../../../../lib/pipeline-fit';

// One FIT chip for the card, the list and the table (lib/pipeline-fit.ts FIT_BANDS). Foundation status tones,
// so each band passes 4.5:1 at 11px, and the band is also a word in the accessible name (never colour alone).
const BAND_TONE: Record<FitBand, StatusTone> = { high: 'success', medium: 'warning', low: 'danger' };
const CHIP = 'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums';

interface PipelineFitChipProps {
  /** A persisted FIT score, or null while it is not calculated yet. */
  score: number | null;
  isPartial?: boolean;
  /** Opens the FIT detail (the card); the list and table show a plain chip. */
  href?: string;
  /** Extra words for the link's accessible name (e.g. "Ver el detalle del FIT de Ana Mora…"). */
  linkDescription?: string;
  /** Narrow places (the kanban card): a pending score is a dash with the words for screen readers. */
  compact?: boolean;
}

/** Text describing the band, e.g. "FIT 82, alto". */
export function useFitChipLabel(): (score: number, isPartial: boolean) => string {
  const { t } = useI18n();
  const p = t.pipeline;
  const bandWord: Record<FitBand, string> = { high: p.fitBandHigh, medium: p.fitBandMedium, low: p.fitBandLow };
  return (score, isPartial) =>
    formatMessage(isPartial ? p.fitChipPartial : p.fitChipLabel, {
      score: Math.round(score),
      band: bandWord[fitBand(score)],
    });
}

export function PipelineFitChip({
  score,
  isPartial = false,
  href,
  linkDescription,
  compact = false,
}: PipelineFitChipProps) {
  const { t } = useI18n();
  const chipLabel = useFitChipLabel();
  if (score === null) {
    if (!compact) return <span className="shrink-0 text-caption text-muted">{t.pipeline.fitPending}</span>;
    return (
      <span className="shrink-0 text-body text-muted" title={t.pipeline.fitPending}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t.pipeline.fitPending}</span>
      </span>
    );
  }
  const label = chipLabel(score, isPartial);
  const classes = `${CHIP} ${STATUS_TONE_CLASSES[BAND_TONE[fitBand(score)]]}`;
  const text = (
    <>
      {Math.round(score)}
      {isPartial ? '*' : ''}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={linkDescription ? `${label}. ${linkDescription}` : label}
        title={label}
        className={`${classes} hover:underline`}
      >
        {text}
      </Link>
    );
  }
  return (
    <span className={classes} title={label}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
