'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from './button';
import { BUTTON_GROUP_CLASSES } from './button-styles';

/**
 * The "unsaved changes" confirmation shown INSIDE an open Modal or Drawer when it is closed while dirty
 * (modality.md: "help people avoid data loss by getting confirmation before closing a modal view").
 * Drawn over the dialog's own content, so there is never a modal on top of a modal.
 */
export function DiscardChangesPrompt({
  onKeepEditing,
  onDiscard,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  const keepRef = useRef<HTMLButtonElement>(null);
  // Safe choice first: focus lands on "Seguir editando", so Enter never discards by accident.
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/95 p-6 animate-fade-in">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-changes-title"
        aria-describedby="discard-changes-body"
        className="w-full max-w-sm text-center"
      >
        <p id="discard-changes-title" className="text-heading font-semibold text-primary">
          {t.common.discardTitle}
        </p>
        <p id="discard-changes-body" className="mt-1 text-body text-secondary">
          {t.common.discardBody}
        </p>
        <div className={`mt-5 ${BUTTON_GROUP_CLASSES} sm:justify-center`}>
          <Button variant="secondary" onClick={onKeepEditing} ref={keepRef}>
            {t.common.keepEditing}
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            {t.common.discard}
          </Button>
        </div>
      </div>
    </div>
  );
}
