'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useDialogA11y } from '../../../../../lib/use-dialog-a11y';
import {
  LEAVE_ACTIONS_CLASSES,
  LEAVE_BODY_CLASSES,
  LEAVE_EYEBROW_CLASSES,
  LEAVE_ICON_CLASSES,
  LEAVE_PANEL_CLASSES,
  LEAVE_TITLE_CLASSES,
} from './provider-frame-styles';
import {
  EVAL_ALERT_EXTRA_CLASSES,
  EVAL_ALERT_EYEBROW_DANGER_CLASSES,
  EVAL_ALERT_ICON_DANGER_CLASSES,
  EVAL_ALERT_SCRIM_CLASSES,
  EVAL_ALERT_TITLE_ALONE_CLASSES,
  type EvalAlertTone,
} from './eval-control-styles';

const ICON: Record<EvalAlertTone, string> = { warn: LEAVE_ICON_CLASSES, danger: EVAL_ALERT_ICON_DANGER_CLASSES };
const EYEBROW: Record<EvalAlertTone, string> = {
  warn: LEAVE_EYEBROW_CLASSES,
  danger: EVAL_ALERT_EYEBROW_DANGER_CLASSES,
};

/**
 * A confirm dialog on the dashboard ("¿Retirar su postulación?", "¿Revocar la autorización?") in the PCA AlertDialog
 * recipe — the one the frame's leave dialog uses (LEAVE_* in provider-frame-styles.ts): a white 520px card over the navy
 * scrim, a 56px toned icon tile, an optional uppercase eyebrow, the question (1.3rem bold sans), the body, then the
 * actions (phones stacked, md one trailing row). Pass the actions as EvalButtons: Cancel (secondary) FIRST in the DOM,
 * the confirm (danger) last.
 *
 * role defaults to "dialog" (the role these dialogs had as the shared Modal: tests and assistive tech find them by it).
 * Built on lib/use-dialog-a11y: Escape calls onClose, Tab stays inside, focus starts on the first control (Cancel, the
 * safe one) unless one is marked data-autofocus, and returns to the opener on close. A click on the scrim does nothing
 * (a blocking question, as in the PCA).
 */
export function EvalAlertDialog({
  tone = 'warn',
  icon,
  eyebrow,
  title,
  body,
  children,
  actions,
  onClose,
  role = 'dialog',
}: {
  tone?: EvalAlertTone;
  /** A lucide icon (aria-hidden), drawn in the 56px tile. */
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  body: ReactNode;
  /** Anything under the body (an error callout with role="alert"). */
  children?: ReactNode;
  actions: ReactNode;
  /** Escape. Ignore it while the action is running (as the dialogs do now). */
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useDialogA11y(panelRef, onClose);
  return (
    <div className={EVAL_ALERT_SCRIM_CLASSES}>
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={LEAVE_PANEL_CLASSES}
      >
        <span aria-hidden="true" className={ICON[tone]}>
          {icon}
        </span>
        {eyebrow && <p className={EYEBROW[tone]}>{eyebrow}</p>}
        <h2 id={titleId} className={eyebrow ? LEAVE_TITLE_CLASSES : EVAL_ALERT_TITLE_ALONE_CLASSES}>
          {title}
        </h2>
        <div id={bodyId} className={LEAVE_BODY_CLASSES}>
          {body}
        </div>
        {children && <div className={EVAL_ALERT_EXTRA_CLASSES}>{children}</div>}
        <div className={LEAVE_ACTIONS_CLASSES}>{actions}</div>
      </div>
    </div>
  );
}
