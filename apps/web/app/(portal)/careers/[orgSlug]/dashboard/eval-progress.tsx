import {
  EVAL_PROGRESS_FILL_CLASSES,
  EVAL_PROGRESS_STEP_WIDTHS,
  EVAL_PROGRESS_TRACK_CLASSES,
  EVAL_PROGRESS_WIDTHS,
} from './eval-control-styles';

/** The fill's width class: exact for a short guide (whole steps, up to 4), else the nearest 5% step. */
function fillWidth(value: number, max: number): string {
  const exact =
    Number.isInteger(value) && value >= 0 && value <= max ? EVAL_PROGRESS_STEP_WIDTHS[max]?.[value] : undefined;
  if (exact) return exact;
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return EVAL_PROGRESS_WIDTHS[Math.round(ratio * 20)] ?? EVAL_PROGRESS_WIDTHS[0];
}

/**
 * The PCA ProgressBar: role progressbar with aria-valuemin / aria-valuemax / aria-valuenow, a 5px (6px md) track in the
 * divider colour and an accent fill. A class per width, no inline style: exact thirds and quarters for the consent
 * guides (1 to 4 steps), 5% steps otherwise.
 */
export function EvalProgress({
  value,
  max,
  label,
  className = '',
}: {
  value: number;
  max: number;
  /** The accessible name ("Step 2 of 3"). */
  label: string;
  className?: string;
}) {
  const width = fillWidth(value, max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`${EVAL_PROGRESS_TRACK_CLASSES} ${className}`}
    >
      <div className={`${EVAL_PROGRESS_FILL_CLASSES} ${width}`} />
    </div>
  );
}
