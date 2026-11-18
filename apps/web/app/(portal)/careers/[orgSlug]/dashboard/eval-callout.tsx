import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import {
  EVAL_CALLOUT_BODY_CLASSES,
  EVAL_CALLOUT_CLASSES,
  EVAL_CALLOUT_TONES,
  type EvalCalloutTone,
} from './eval-control-styles';

const DEFAULT_ICON: Record<EvalCalloutTone, ReactNode> = {
  neutral: <Info aria-hidden="true" />,
  info: <Info aria-hidden="true" />,
  warn: <TriangleAlert aria-hidden="true" />,
  err: <CircleAlert aria-hidden="true" />,
  ok: <CircleCheck aria-hidden="true" />,
};

/**
 * The PCA Callout: a soft box with a toned 20px icon and 13px ink text. Inline errors (err, keep role="alert" where the
 * old markup had it), notes (neutral / info), warnings (warn), confirmations (ok).
 */
export function EvalCallout({
  tone = 'neutral',
  icon,
  role,
  className = '',
  children,
}: {
  tone?: EvalCalloutTone;
  /** A specific lucide icon (aria-hidden), or omit for the tone's default. */
  icon?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role={role} className={`${EVAL_CALLOUT_CLASSES} ${EVAL_CALLOUT_TONES[tone]} ${className}`}>
      {icon ?? DEFAULT_ICON[tone]}
      <div className={EVAL_CALLOUT_BODY_CLASSES}>{children}</div>
    </div>
  );
}
