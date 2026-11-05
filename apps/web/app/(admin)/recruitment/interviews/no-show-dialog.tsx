'use client';

import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

// Confirmation step for "No se presentó" (A-02): closes a started interview nobody scored. No email is
// sent, so there is no reason field (unlike cancelling).
export function NoShowDialog({
  isPending,
  onConfirm,
  onClose,
}: {
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal title={t.interviews.noShowDialogTitle} onClose={onClose} maxWidth="max-w-md">
      <p className="text-sm text-[#585858] mb-4">{t.interviews.noShowDialogBody}</p>
      <div className="flex justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition"
        >
          {t.interviews.noShowDialogBack}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onConfirm}
          className="h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1863] transition disabled:opacity-50"
        >
          {t.interviews.noShowDialogConfirm}
        </button>
      </div>
    </Modal>
  );
}
