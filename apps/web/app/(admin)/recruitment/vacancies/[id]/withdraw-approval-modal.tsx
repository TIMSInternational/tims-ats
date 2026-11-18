'use client';

import { useI18n } from '../../../../../lib/i18n';
import { ConfirmDialog } from '../../../../../components';

interface WithdrawApprovalModalProps {
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

/** Confirms taking a pending approval request back (the vacancy returns to draft). */
export function WithdrawApprovalModal({ onConfirm, onClose, isPending }: WithdrawApprovalModalProps) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      title={t.vacancies.withdrawApprovalTitle}
      description={t.vacancies.withdrawApprovalDesc}
      confirmLabel={t.vacancies.withdrawApprovalConfirm}
      confirmingLabel={t.vacancies.withdrawing}
      loading={isPending}
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
}
