'use client';

import { useState } from 'react';
import { Modal } from '../../../../../components';
import { Button } from '../../../../../components/button';
import { DialogCancelButton } from '../../../../../components/dialog-cancel-button';
import { FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES, textareaClasses } from '../../../../../components/field-styles';
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
    <Modal
      title={t.offers.withdrawOfferTitle}
      description={t.offers.withdrawOfferPrompt}
      onClose={onClose}
      size="sm"
      dirty={reason.trim().length > 0 && !withdraw.isPending}
      footer={
        <>
          {/* Routes through the Modal's dirty guard, like X and Escape: a typed reason is not lost silently. */}
          <DialogCancelButton onCancel={onClose} disabled={withdraw.isPending} />
          {/* Irreversible: the destructive role, never the navy primary (buttons.md › Role). */}
          <Button variant="destructive" onClick={confirm} loading={withdraw.isPending}>
            {t.offers.withdrawOfferConfirm}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {wasSent && (
          <p role="note" className="rounded-lg bg-warning-bg px-3 py-2 text-callout text-warning">
            {t.offers.withdrawOfferSentWarning}
          </p>
        )}
        <div>
          <label htmlFor="withdraw-offer-reason" className={FIELD_LABEL_CLASSES}>
            {t.offers.withdrawOfferReason}
          </label>
          <textarea
            id="withdraw-offer-reason"
            value={reason}
            maxLength={MAX_REASON}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            className={textareaClasses('resize-none')}
          />
        </div>
        {error && (
          <p role="alert" className={FIELD_ERROR_CLASSES}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
