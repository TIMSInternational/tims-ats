'use client';

import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface CancelModalProps {
  orgName: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

export function CancelModal({
  orgName,
  onConfirm,
  onClose,
  isPending,
}: CancelModalProps) {
  const { t } = useI18n();

  return (
    <Modal title={`${t.subscriptions.confirmCancel} ${orgName}?`} onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-red-50">
          <p className="text-sm text-[#DD0C15]">{t.subscriptions.confirmCancelDesc}</p>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="h-9 px-4 rounded-lg bg-[#DD0C15] text-sm text-white font-medium hover:bg-red-700 transition disabled:opacity-50"
          >
            {isPending ? t.common.saving : t.subscriptions.cancel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
