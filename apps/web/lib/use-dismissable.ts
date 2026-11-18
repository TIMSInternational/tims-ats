'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Popover / menu dismissal (popovers.md › Best practices): an outside mousedown or Escape closes it, and
 * Escape returns focus to the trigger. One hook for every shell popover (language, profile, notifications)
 * and the shared Menu, instead of a click-outside hook copied per file.
 */
export function useDismissable(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Only when focus is in this popover (or nowhere): an Escape meant for an open dialog is not ours.
      const active = document.activeElement;
      if (active && active !== document.body && !containerRef.current?.contains(active)) return;
      event.stopPropagation();
      closeRef.current();
      triggerRef?.current?.focus();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, containerRef, triggerRef]);
}
