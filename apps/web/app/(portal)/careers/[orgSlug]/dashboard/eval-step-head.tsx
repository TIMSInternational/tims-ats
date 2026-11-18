'use client';

import { formatMessage, useI18n } from '../../../../../lib/i18n';
import { EvalProgress } from './eval-progress';
import { EVAL_STEP_HEAD_CLASSES } from './eval-control-styles';
import { EVAL_EYEBROW_CLASSES } from './eval-styles';

/**
 * The PCA SheetHead for a multi-step guide (the consent guide), replacing the shared Stepper: the eyebrow
 * "Step 1 of 3 · Notice" (the same words the Stepper shows, in one paragraph) over the PCA ProgressBar.
 *
 * It keeps the Stepper's contracts: a navigation landmark named t.common.steps ("Steps") with one listitem per step, the
 * current one with aria-current="step" and its label as text, done ones with "(completed)". The list is for assistive
 * tech and tests only (sr-only); the eyebrow and the bar are what the eye sees, as in the PCA item screen.
 */
export function EvalStepHead({
  steps,
  current,
  label,
  className = '',
}: {
  /** Step labels, already translated. */
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
  /** Accessible name of the nav; defaults to t.common.steps. */
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const position = formatMessage(t.common.stepOf, { current: current + 1, total: steps.length });
  const currentLabel = steps[current];
  return (
    <nav aria-label={label ?? t.common.steps} className={`${EVAL_STEP_HEAD_CLASSES} ${className}`}>
      <p className={EVAL_EYEBROW_CLASSES}>
        {position}
        {currentLabel && ` · ${currentLabel}`}
      </p>
      <EvalProgress value={current + 1} max={steps.length} label={position} />
      <ol className="sr-only">
        {steps.map((step, index) => (
          <li key={step} aria-current={index === current ? 'step' : undefined}>
            {step}
            {index < current && ` (${t.common.stepDone})`}
          </li>
        ))}
      </ol>
    </nav>
  );
}
