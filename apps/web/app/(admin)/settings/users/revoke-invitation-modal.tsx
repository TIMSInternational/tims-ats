'use client';

import { Modal } from '../../../../components/modal';
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
    <Modal title={m.revokeConfirmTitle} onClose={onCancel} maxWidth="max-w-md">
      <p className="text-sm text-[#585858]">{m.revokeConfirmMessage.replace('{email}', email)}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F7F7F7] transition"
        >
          {m.cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {m.confirmRevoke}
        </button>
      </div>
    </Modal>
  );
}
