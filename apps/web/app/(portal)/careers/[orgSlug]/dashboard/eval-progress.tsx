import { EVAL_PROGRESS_FILL_CLASSES, EVAL_PROGRESS_TRACK_CLASSES, EVAL_PROGRESS_WIDTHS } from './eval-control-styles';

/**
 * The PCA ProgressBar: role progressbar with aria-valuemin / aria-valuemax / aria-valuenow, a 5px (6px md) track in the
 * divider colour and an accent fill. The fill snaps to 5% steps (a class per step: no inline style).
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
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const width = EVAL_PROGRESS_WIDTHS[Math.round(ratio * 20)] ?? EVAL_PROGRESS_WIDTHS[0];
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
