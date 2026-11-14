'use client';

import React, { useId, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useDialogA11y } from '../lib/use-dialog-a11y';
import { IconButton } from './icon-button';
import { DiscardChangesPrompt } from './discard-changes-prompt';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_WIDTH: Record<ModalSize, string> = {
  sm: 'sm:max-w-md', // confirm dialogs
  md: 'sm:max-w-lg', // short tasks (the default)
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

// Phones: a bottom sheet (or a full-screen sheet); from sm a centred card.
const SHAPE_SHEET = 'max-h-[90dvh] rounded-t-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl';
const SHAPE_FULL_SCREEN = 'h-dvh max-h-dvh rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl';

interface ModalProps {
  /** Names the task ("Programar entrevista"), or states the outcome in a confirm ("¿Rechazar a Diana Vega?"). */
  title: string;
  /** Optional line under the title. */
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Sticky action row: Cancel (secondary) first, the primary verb last. Stacks full width below sm. */
  footer?: React.ReactNode;
  size?: ModalSize;
  /** Legacy width override (e.g. 'max-w-xl'); prefer `size`. */
  maxWidth?: string;
  /** Unsaved changes: closing (Esc, overlay, ✕) asks "¿Descartar los cambios?" first. */
  dirty?: boolean;
  /** Phones: a full-screen sheet instead of a bottom sheet (multi-step flows like the apply form). */
  fullScreenOnMobile?: boolean;
  /** Extra classes for the body (e.g. to drop its padding for a full-bleed list). */
  bodyClassName?: string;
}

/**
 * The shared dialog (foundation-spec.md §9). Focus trap, Escape and focus return; initial focus goes to an
 * autoFocus field or `[data-autofocus]` element, else the first control. Below sm it is a bottom sheet
 * (popovers.md › Mobile: "use all available screen space … like a sheet").
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  maxWidth,
  dirty = false,
  fullScreenOnMobile = false,
  bodyClassName = '',
}: ModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `modal-title-${useId()}`;
  const descriptionId = description ? `${titleId}-description` : undefined;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const requestClose = () => {
    if (dirty && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    if (confirmingDiscard) {
      setConfirmingDiscard(false);
      return;
    }
    onClose();
  };
  useDialogA11y(dialogRef, requestClose);

  // A legacy maxWidth is used as given: on phones the panel is full width anyway.
  const width = maxWidth ?? SIZE_WIDTH[size];
  const shape = fullScreenOnMobile ? SHAPE_FULL_SCREEN : SHAPE_SHEET;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={requestClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={`relative flex w-full flex-col overflow-hidden bg-white shadow-2xl animate-sheet-up sm:mx-4 ${width} ${shape}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-heading font-semibold text-primary">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-callout text-secondary">
                {description}
              </p>
            )}
          </div>
          <IconButton label={t.common.close} size="sm" onClick={requestClose} className="-mr-2 -mt-0.5">
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
        <div
          inert={confirmingDiscard || undefined}
          className={`min-h-0 flex-1 overflow-y-auto px-6 pb-6 ${bodyClassName}`}
        >
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
