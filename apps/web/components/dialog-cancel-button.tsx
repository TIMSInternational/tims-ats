'use client';

import React from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from './button';
import { useDialogClose } from './dialog-close-context';

interface DialogCancelButtonProps {
  /** Used only when the button is rendered outside a Modal/Drawer. */
  onCancel: () => void;
  disabled?: boolean;
  /** Defaults to "Cancelar". */
  children?: React.ReactNode;
}

/**
 * The secondary "Cancelar" for a Modal/Drawer footer. It goes through the dialog's dirty guard, so unsaved
 * changes ask "¿Descartar los cambios?" exactly like ✕, Escape and the backdrop (modality.md › Best practices).
 */
export function DialogCancelButton({ onCancel, disabled, children }: DialogCancelButtonProps) {
  const { t } = useI18n();
  const close = useDialogClose(onCancel);
  return (
    <Button variant="secondary" onClick={close} disabled={disabled}>
      {children ?? t.common.cancel}
    </Button>
  );
}
