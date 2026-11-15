'use client';

import { useState } from 'react';
import { Modal } from '../../../../components';
import { Button } from '../../../../components/button';
import { DialogCancelButton } from '../../../../components/dialog-cancel-button';
import { FIELD_LABEL_CLASSES, textareaClasses } from '../../../../components/field-styles';
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
    <Modal
      title={t.interviews.cancelDialogTitle}
      description={t.interviews.cancelDialogBody}
      onClose={onClose}
      size="sm"
      dirty={reason.trim().length > 0}
      footer={
        <>
          {/* Routes through the Modal's dirty guard, like X and Escape: a typed reason is not lost silently. */}
          <DialogCancelButton onCancel={onClose}>{t.interviews.cancelDialogKeep}</DialogCancelButton>
          <Button
            variant="destructive"
            loading={isPending}
            onClick={() => onConfirm(resolveCancelReason(reason, t.interviews.cancelReasonDefault))}
          >
            {t.interviews.cancelDialogConfirm}
          </Button>
        </>
      }
    >
      <label htmlFor="cancel-interview-reason" className={FIELD_LABEL_CLASSES}>
        {t.interviews.cancelReasonLabel}
      </label>
      <textarea
        id="cancel-interview-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={CANCEL_REASON_MAX}
        rows={3}
        placeholder={t.interviews.cancelReasonDefault}
        className={textareaClasses('resize-none')}
      />
    </Modal>
  );
}
