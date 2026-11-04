'use client';

import { useI18n } from '../../../../../lib/i18n';
import { Modal } from '../../../../../components';

interface WithdrawApprovalModalProps {
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

/** Confirms taking a pending approval request back (the vacancy returns to draft). */
export function WithdrawApprovalModal({ onConfirm, onClose, isPending }: WithdrawApprovalModalProps) {
  const { t } = useI18n();

  return (
    <Modal title={t.vacancies.withdrawApprovalTitle} onClose={onClose}>
      <p className="text-xs text-[#8B8B8B] mb-4">{t.vacancies.withdrawApprovalDesc}</p>
      <div className="flex justify-end gap-3 mt-6">
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1863] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.vacancies.withdrawApprovalConfirm}
        </button>
      </div>
    </Modal>
  );
}
