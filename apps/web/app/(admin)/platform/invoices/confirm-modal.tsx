'use client';

import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmColor = 'bg-[#1F114C] hover:bg-[#2a1866]',
  onConfirm,
  onClose,
  isPending,
}: ConfirmModalProps) {
  const { t } = useI18n();

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[#585858]">{message}</p>
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
            className={`h-9 px-4 rounded-lg text-sm text-white font-medium transition disabled:opacity-50 ${confirmColor}`}
          >
            {isPending ? t.common.saving : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
