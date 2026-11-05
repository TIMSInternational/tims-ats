'use client';

import { useEffect, useRef, type RefObject } from 'react';

// Keyboard behaviour of the shared Modal (components/modal.tsx) for a dialog that cannot use the Modal
// shell itself, such as the full-screen, printable offer letter (Pilot UX audit E-30): Escape closes, Tab
// stays inside the dialog, focus moves in on open and returns to the opener on close.

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(containerRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  // The latest onClose without re-running the effect (which would steal focus on every render).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        return;
      }
      const container = containerRef.current;
      if (event.key !== 'Tab' || !container) return;
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const timer = setTimeout(() => containerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
      previouslyFocused?.focus();
    };
  }, [containerRef]);
}
