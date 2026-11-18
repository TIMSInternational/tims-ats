'use client';

import { ConfirmDialog } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';

interface CancelModalProps {
  orgName: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

/** "Cancelar" keeps the subscription; the red verb names what ends (alerts.md › Buttons). */
export function CancelModal({ orgName, onConfirm, onClose, isPending }: CancelModalProps) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      title={formatMessage(t.subscriptions.confirmCancelTitle, { org: orgName })}
      description={t.subscriptions.confirmCancelDesc}
      confirmLabel={t.subscriptions.cancelSubscription}
      destructive
      loading={isPending}
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
}
