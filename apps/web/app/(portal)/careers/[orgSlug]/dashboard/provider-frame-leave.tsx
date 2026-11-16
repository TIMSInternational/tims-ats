'use client';

import type { Ref } from 'react';
import {
  LEAVE_ACTIONS_CLASSES,
  LEAVE_BODY_CLASSES,
  LEAVE_CONFIRM_CLASSES,
  LEAVE_EYEBROW_CLASSES,
  LEAVE_ICON_CLASSES,
  LEAVE_PANEL_CLASSES,
  LEAVE_SCRIM_CLASSES,
  LEAVE_STAY_CLASSES,
  LEAVE_TITLE_CLASSES,
} from './provider-frame-styles';

// "¿Salir de la evaluación?" in the PCA app's blocking AlertDialog (warn recipe): a white card over the navy scrim,
// covering the test, with a warn eyebrow and the question as a heading.
// Staying is the default (focused, and the primary); leaving is the secondary. The frame owns the open state and
// Escape; the copy arrives in the test's language.
export function ProviderFrameLeave({
  eyebrow,
  title,
  body,
  confirmLabel,
  stayLabel,
  stayRef,
  onConfirm,
  onStay,
}: {
  eyebrow: string;
  title: string;
  body: string;
  confirmLabel: string;
  stayLabel: string;
  stayRef: Ref<HTMLButtonElement>;
  onConfirm: () => void;
  onStay: () => void;
}) {
  return (
    <div className={LEAVE_SCRIM_CLASSES}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="provider-leave-title"
        aria-describedby="provider-leave-body"
        className={LEAVE_PANEL_CLASSES}
      >
        <span aria-hidden="true" className={LEAVE_ICON_CLASSES}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
            />
          </svg>
        </span>
        <p className={LEAVE_EYEBROW_CLASSES}>{eyebrow}</p>
        <h2 id="provider-leave-title" className={LEAVE_TITLE_CLASSES}>
          {title}
        </h2>
        <p id="provider-leave-body" className={LEAVE_BODY_CLASSES}>
          {body}
        </p>
        <div className={LEAVE_ACTIONS_CLASSES}>
          <button type="button" className={LEAVE_CONFIRM_CLASSES} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" ref={stayRef} className={LEAVE_STAY_CLASSES} onClick={onStay}>
            {stayLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
