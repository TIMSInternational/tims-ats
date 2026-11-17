import type { ReactNode } from 'react';
import { EVAL_BIG_ICON_CLASSES, EVAL_BIG_ICON_TONES, type EvalBigIconTone } from './eval-styles';

/** The PCA BigIcon of a state screen: a 56px toned tile with a 28px lucide icon. Decorative. */
export function EvalBigIcon({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: EvalBigIconTone;
  className?: string;
  /** The lucide icon. */
  children: ReactNode;
}) {
  return (
    <div aria-hidden="true" className={`${EVAL_BIG_ICON_CLASSES} ${EVAL_BIG_ICON_TONES[tone]} ${className}`}>
      {children}
    </div>
  );
}
