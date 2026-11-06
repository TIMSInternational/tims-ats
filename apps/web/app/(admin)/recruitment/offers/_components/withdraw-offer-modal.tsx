'use client';

import { useState } from 'react';
import { Modal } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { describeOfferActionError, isStateConflict } from '../../../../../lib/offer-action-error';

const MAX_REASON = 500;

// "Retirar oferta" confirmation (B-04): a deliberate second step, an optional reason (kept in the offer
// history) and, for a sent offer, the warning that the candidate's link stops working.
export function WithdrawOfferModal({
  offerId,
  wasSent,
  onClose,
  onWithdrawn,
}: {
  offerId: string;
  wasSent: boolean;
  onClose: () => void;
  onWithdrawn: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const withdraw = trpc.offer.withdraw.useMutation();

  const confirm = async () => {
    setError(null);
    try {
      const trimmed = reason.trim();
      await withdraw.mutateAsync({ id: offerId, ...(trimmed ? { reason: trimmed } : {}) });
      toast(t.offers.offerWithdrawnToast, { type: 'success' });
      onWithdrawn();
      onClose();
    } catch (cause) {
      const message = describeOfferActionError(cause, {
        forbidden: t.offers.errorForbiddenAction,
        generic: t.offers.errorOfferAction,
      });
      setError(message);
      toast(message, { type: 'error' });
      // The offer moved on (accepted, approved…): refresh the screen behind the dialog.
      if (isStateConflict(cause)) onWithdrawn();
    }
  };

  return (
    <Modal title={t.offers.withdrawOfferTitle} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[13px] text-[#585858]">{t.offers.withdrawOfferPrompt}</p>
        {wasSent && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            {t.offers.withdrawOfferSentWarning}
          </p>
        )}
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.withdrawOfferReason}
          <textarea
            value={reason}
            maxLength={MAX_REASON}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]"
          />
        </label>
        {error && (
          <p role="alert" className="text-[12px] text-[#DD0C15]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={withdraw.isPending}
            className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={withdraw.isPending}
            className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t.offers.withdrawOfferConfirm}
          </button>
        </div>
      </div>
    </Modal>
  );
}
