'use client';

import { useState } from 'react';
import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { CANCEL_REASON_MAX, resolveCancelReason } from './interview-cancel';

// Confirmation step for cancelling an interview (the list used to cancel on one click). The reason is
// optional; blank sends the default Spanish reason.
export function CancelInterviewDialog({
  isPending,
  onConfirm,
  onClose,
}: {
  isPending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');

  return (
    <Modal title={t.interviews.cancelDialogTitle} onClose={onClose} maxWidth="max-w-md">
      <p className="text-sm text-[#585858] mb-4">{t.interviews.cancelDialogBody}</p>
      <label htmlFor="cancel-interview-reason" className="block text-xs font-medium text-[#585858] mb-1">
        {t.interviews.cancelReasonLabel}
      </label>
      <textarea
        id="cancel-interview-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={CANCEL_REASON_MAX}
        rows={3}
        placeholder={t.interviews.cancelReasonDefault}
        className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none"
      />
      <div className="flex justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition"
        >
          {t.interviews.cancelDialogKeep}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => onConfirm(resolveCancelReason(reason, t.interviews.cancelReasonDefault))}
          className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {t.interviews.cancelDialogConfirm}
        </button>
      </div>
    </Modal>
  );
}
