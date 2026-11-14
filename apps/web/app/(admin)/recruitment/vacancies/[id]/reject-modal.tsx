'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Button, Field, Modal, TextInput } from '../../../../../components';
import { requestDialogClose } from '../request-dialog-close';

interface RejectModalProps {
  onConfirm: (comment: string) => void;
  onClose: () => void;
  isPending: boolean;
}

/** The approver's "Rechazar vacante", with the reason the submitter will read in the approval chain. */
export function RejectModal({ onConfirm, onClose, isPending }: RejectModalProps) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');

  return (
    <Modal
      title={t.vacancies.rejectConfirmTitle}
      description={t.vacancies.rejectConfirmDesc}
      onClose={onClose}
      size="sm"
      dirty={comment.trim().length > 0 && !isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={(e) => requestDialogClose(e, t.common.close, onClose)}
            disabled={isPending}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(comment)}
            disabled={!comment.trim()}
            loading={isPending}
            loadingLabel={t.vacancies.rejecting}
          >
            {t.vacancies.rejectVacancyConfirm}
          </Button>
        </>
      }
    >
      <Field label={t.vacancies.rejectReason} required>
        <TextInput
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t.vacancies.rejectReasonPlaceholder}
          maxLength={1000}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
