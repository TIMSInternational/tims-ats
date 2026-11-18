'use client';

import { useEffect, useRef, type RefObject } from 'react';

// Keyboard behaviour shared by Modal, Drawer, the mobile nav drawer and any dialog that cannot use the
// Modal shell itself (e.g. the full-screen, printable offer letter, Pilot UX audit E-30): Escape closes,
// Tab stays inside the dialog, focus moves in on open and returns to the opener on close.

export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  // The latest onClose without re-running the effect (which would steal focus on every render).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
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
    // Initial focus: keep it if something inside already took it (an autoFocus field); otherwise an
    // element marked data-autofocus; otherwise the first focusable element.
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container || container.contains(document.activeElement)) return;
      const preferred = container.querySelector<HTMLElement>('[data-autofocus]');
      (preferred ?? container.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
      previouslyFocused?.focus();
    };
  }, [containerRef, enabled]);
}
