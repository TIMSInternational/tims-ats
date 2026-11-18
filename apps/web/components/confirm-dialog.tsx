'use client';

import React from 'react';
import { useI18n } from '../lib/i18n';
import { Modal } from './modal';
import { Button } from './button';

interface ConfirmDialogProps {
  /** States the outcome as a question that names the object: "¿Rechazar a Diana Vega?". */
  title: string;
  /** One sentence of consequence: "Se le enviará un correo y saldrá del pipeline." */
  description?: React.ReactNode;
  /** A specific verb, never OK / Sí: "Rechazar", "Eliminar plantilla". */
  confirmLabel: string;
  /** While the action runs: "Rechazando…". */
  confirmingLabel?: string;
  /** Defaults to t.common.cancel (alerts.md › Buttons: "Always use Cancel"). */
  cancelLabel?: string;
  /** Red confirm button for an action that destroys data or cannot be undone. */
  destructive?: boolean;
  /** The action is in flight: the confirm button shows a spinner and both buttons wait. */
  loading?: boolean;
  /** An inline error from the failed action, shown above the buttons. */
  error?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content between the description and the buttons (e.g. a reason field). */
  children?: React.ReactNode;
}

/**
 * Confirmation for an uncommon, irreversible or destructive action (foundation-spec.md §9, alerts.md).
 * Replaces window.confirm(). Cancel leads, the named verb trails.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmingLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  error,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      title={title}
      description={description}
      onClose={loading ? () => undefined : onCancel}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? t.common.cancel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            loadingLabel={confirmingLabel}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && (
        <p role="alert" className="text-callout text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
