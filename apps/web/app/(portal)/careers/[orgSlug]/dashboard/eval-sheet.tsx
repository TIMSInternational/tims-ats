'use client';

import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogA11y } from '../../../../../lib/use-dialog-a11y';
import { EvalButton } from './eval-button';
import {
  EVAL_SHEET_BACKDROP_CLASSES,
  EVAL_SHEET_BODY_CLASSES,
  EVAL_SHEET_CLOSE_X_CLASSES,
  EVAL_SHEET_FOOT_CLASSES,
  EVAL_SHEET_GRABBER_CLASSES,
  EVAL_SHEET_HEAD_CLASSES,
  EVAL_SHEET_PANEL_CLASSES,
  EVAL_SHEET_SCRIM_CLASSES,
  EVAL_SHEET_TITLE_PAD_CLASSES,
} from './eval-control-styles';
import { EVAL_TITLE_3_CLASSES } from './eval-styles';

/**
 * The PCA bottom sheet (Sheet, PCA-DESIGN §6) for reading a long text in place: over the navy scrim, a bottom sheet on
 * phones (rounded top, grabber, max 85dvh, scrolls, safe-area room) and a centred 520px card from md, entering with
 * r-sheet-in. role="dialog", aria-modal, named by its title (title3).
 *
 * Built on lib/use-dialog-a11y: Escape closes, Tab stays inside, focus goes to `[data-autofocus]` (put it on the text
 * container, with tabIndex 0, so the keyboard scrolls it and a screen reader starts on the text) and returns to the
 * opener on close. It closes with the ✕ (named closeLabel), a click on the scrim, Escape, and the full-width button at
 * the end of the text — the LAST button named closeLabel in the dialog (the e2e clicks `.last()`).
 */
export function EvalSheet({
  title,
  closeLabel,
  onClose,
  lang,
  children,
}: {
  title: string;
  /** "Close" (t.common.close): the ✕'s name and the button at the end. */
  closeLabel: string;
  onClose: () => void;
  /** The title's and text's language when it is not the page's. */
  lang?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogA11y(panelRef, onClose);
  return (
    <div className={EVAL_SHEET_SCRIM_CLASSES}>
      <div aria-hidden="true" className={EVAL_SHEET_BACKDROP_CLASSES} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={EVAL_SHEET_PANEL_CLASSES}
      >
        <div aria-hidden="true" className={EVAL_SHEET_GRABBER_CLASSES} />
        <div className={EVAL_SHEET_HEAD_CLASSES}>
          <h2 id={titleId} lang={lang} className={`${EVAL_TITLE_3_CLASSES} ${EVAL_SHEET_TITLE_PAD_CLASSES}`}>
            {title}
          </h2>
          <button type="button" aria-label={closeLabel} onClick={onClose} className={EVAL_SHEET_CLOSE_X_CLASSES}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div lang={lang} className={EVAL_SHEET_BODY_CLASSES}>
          {children}
        </div>
        <div className={EVAL_SHEET_FOOT_CLASSES}>
          <EvalButton variant="secondary" width="full" onClick={onClose}>
            {closeLabel}
          </EvalButton>
        </div>
      </div>
    </div>
  );
}
