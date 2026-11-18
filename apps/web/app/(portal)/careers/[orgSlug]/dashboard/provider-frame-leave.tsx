'use client';

import { useEffect, useRef, type Ref } from 'react';
import { LogOut } from 'lucide-react';
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
// Focus stays in the dialog. It is modal, but drawn inline in the dashboard rather than in the browser's top layer:
// the bar and the test are inert, the page around the frame is not, so Tab past the last button (or Shift+Tab before
// the first) would land on something hidden under the scrim. Tab and Shift+Tab therefore cycle between the two
// buttons. The listener is on the document, not on the dialog, because a click on the scrim or on the dialog's text
// leaves focus on the page body, where a key handler on the dialog would never hear the Tab.
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = panelRef.current ? Array.from(panelRef.current.querySelectorAll('button')) : [];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = active instanceof Node && panelRef.current?.contains(active) === true;
      const wraps = event.shiftKey ? !inside || active === first : !inside || active === last;
      if (!wraps) return;
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={LEAVE_SCRIM_CLASSES}>
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="provider-leave-title"
        aria-describedby="provider-leave-body"
        className={LEAVE_PANEL_CLASSES}
      >
        <span aria-hidden="true" className={LEAVE_ICON_CLASSES}>
          <LogOut aria-hidden="true" />
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
