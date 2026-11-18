'use client';

import { useRef } from 'react';
import { useI18n } from '../../lib/i18n';
import { useDialogA11y } from '../../lib/use-dialog-a11y';

/**
 * The sidebar's container. From lg it is a static column; below lg an off-canvas drawer that, while open,
 * is a modal dialog: focus moves in, Tab stays inside, Escape closes it and focus returns to the hamburger.
 * Closed, it is `invisible`, so its links leave the tab order and the accessibility tree.
 */
const OPEN_CLASSES = 'visible translate-x-0';
const CLOSED_CLASSES = 'invisible -translate-x-full';

export function ShellDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose, { enabled: open });

  return (
    <div
      ref={ref}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? true : undefined}
      aria-label={open ? t.nav.menu : undefined}
      className={`fixed inset-y-0 left-0 z-40 transition-[transform,visibility] duration-200 ease-out lg:visible lg:static lg:z-auto lg:translate-x-0 ${
        open ? OPEN_CLASSES : CLOSED_CLASSES
      }`}
    >
      {children}
    </div>
  );
}
