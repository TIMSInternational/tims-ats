'use client';

import { useState } from 'react';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { Button, Field, Modal, TextInput } from '../../../../components';

interface CloseModalProps {
  vacancyTitle: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  isPending: boolean;
}

/** Confirms "Cerrar vacante" (alerts.md › Buttons: a specific verb, never a bare "Cerrar"), with its required reason. */
export function CloseModal({ vacancyTitle, onConfirm, onClose, isPending }: CloseModalProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');

  return (
    <Modal
      title={formatMessage(t.vacancies.confirmClose, { title: vacancyTitle })}
      description={t.vacancies.confirmCloseDesc}
      onClose={onClose}
      size="sm"
      dirty={reason.trim().length > 0 && !isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason)}
            disabled={!reason.trim()}
            loading={isPending}
            loadingLabel={t.vacancies.closing}
          >
            {t.vacancies.closeVacancyConfirm}
          </Button>
        </>
      }
    >
      <Field label={t.vacancies.closeReason} required>
        <TextInput
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t.vacancies.closeReasonPlaceholder}
          maxLength={1000}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
