'use client';

import React, { useId, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useDialogA11y } from '../lib/use-dialog-a11y';
import { IconButton } from './icon-button';
import { DiscardChangesPrompt } from './discard-changes-prompt';

export type DrawerSize = 'md' | 'lg' | 'xl';

const SIZE_WIDTH: Record<DrawerSize, string> = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
};

interface DrawerProps {
  title: string;
  /** A line under the title (record meta, e.g. the agent's model). */
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Sticky action row: Cancel first, the primary verb last. */
  footer?: React.ReactNode;
  /** Content under the title row, inside the sticky header — e.g. Tabs. */
  header?: React.ReactNode;
  size?: DrawerSize;
  /** Unsaved changes: closing asks "¿Descartar los cambios?" first. */
  dirty?: boolean;
}

/**
 * Right-hand drawer for editing or inspecting a record while the list stays in view (foundation-spec.md §9).
 * Full width below sm.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  header,
  size = 'md',
  dirty = false,
}: DrawerProps) {
  const { t } = useI18n();
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleId = `drawer-title-${useId()}`;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const requestClose = () => {
    if (confirmingDiscard) {
      setConfirmingDiscard(false);
      return;
    }
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  };
  useDialogA11y(drawerRef, requestClose);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={requestClose} aria-hidden="true" />
      <div
        ref={drawerRef}
        className={`relative flex h-full w-full flex-col bg-white shadow-2xl animate-slide-in-right ${SIZE_WIDTH[size]}`}
      >
        <div className="shrink-0 border-b border-border">
          <div className="flex items-start justify-between gap-4 px-6 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-heading font-semibold text-primary">
                {title}
              </h2>
              {subtitle && <p className="mt-0.5 text-callout text-secondary">{subtitle}</p>}
            </div>
            <IconButton label={t.common.close} size="sm" onClick={requestClose} className="-mr-2">
              <svg
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IconButton>
          </div>
          {header && <div className="px-6">{header}</div>}
        </div>
        <div inert={confirmingDiscard || undefined} className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
        {footer && (
          <div
            inert={confirmingDiscard || undefined}
            className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-white px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end"
          >
            {footer}
          </div>
        )}
        {confirmingDiscard && (
          <DiscardChangesPrompt onKeepEditing={() => setConfirmingDiscard(false)} onDiscard={onClose} />
        )}
      </div>
    </div>
  );
}
