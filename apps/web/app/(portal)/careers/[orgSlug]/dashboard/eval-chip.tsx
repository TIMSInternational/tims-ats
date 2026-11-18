import type { ReactNode } from 'react';
import { Check, Circle, CircleAlert, X } from 'lucide-react';
import { EVAL_CHIP_CLASSES, EVAL_CHIP_TONES, type EvalChipTone } from './eval-control-styles';

/** The icon each tone shows unless the caller passes a more specific one (Clock, Hourglass, CalendarClock…). */
const DEFAULT_ICON: Record<EvalChipTone, ReactNode> = {
  neutral: <Circle aria-hidden="true" />,
  warn: <CircleAlert aria-hidden="true" />,
  ok: <Check aria-hidden="true" strokeWidth={2.5} />,
  danger: <X aria-hidden="true" strokeWidth={2.5} />,
};

/**
 * A status as the PCA Chip draws it: a pill with a word AND a 14px lucide icon, never colour alone. Replaces the shared
 * StatusBadge on the candidate dashboard. neutral = informational / waiting on the team; warn = needs the candidate's
 * action ("Consent needed"); ok = done; danger = failed, expired, withdrawn, declined.
 */
export function EvalChip({
  tone = 'neutral',
  icon,
  className = '',
  children,
}: {
  tone?: EvalChipTone;
  /** A specific lucide icon (give it aria-hidden), or omit for the tone's default. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`${EVAL_CHIP_CLASSES} ${EVAL_CHIP_TONES[tone]} ${className}`}>
      {icon ?? DEFAULT_ICON[tone]}
      {children}
    </span>
  );
}
