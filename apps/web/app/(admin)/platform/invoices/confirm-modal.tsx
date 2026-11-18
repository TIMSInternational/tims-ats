'use client';

import { ConfirmDialog } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm for an action that cannot be undone (Anular); everything else confirms in navy. */
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

/** Invoice status confirmations on the shared ConfirmDialog (Cancelar leads, the named verb trails). */
export function ConfirmModal({ title, message, confirmLabel, destructive = false, onConfirm, onClose, isPending }: ConfirmModalProps) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      title={title}
      description={message}
      confirmLabel={confirmLabel}
      confirmingLabel={t.common.saving}
      destructive={destructive}
      loading={isPending}
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
}
