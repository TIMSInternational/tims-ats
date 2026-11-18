'use client';

import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { useI18n } from '../../../../lib/i18n';

export function RevokeInvitationModal({
  email,
  isPending,
  onCancel,
  onConfirm,
}: {
  email: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const m = t.teamSettings;
  return (
    <ConfirmDialog
      title={m.revokeConfirmTitle.replace('{email}', email)}
      description={m.revokeConfirmMessage}
      confirmLabel={m.confirmRevoke}
      confirmingLabel={m.revoking}
      cancelLabel={m.cancel}
      destructive
      loading={isPending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
