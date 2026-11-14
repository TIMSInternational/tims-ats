'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, Modal, TextArea } from '../../../../components';
import { useAccessReviewAttest } from '../../../../lib/platform-api/access-review';

interface AttestModalProps {
  organizationId: string;
  onClose: () => void;
}

const MAX_NOTES = 2000;
const TRUNCATED_MESSAGE = 'La organización excede 10000 usuarios; no se puede certificar automáticamente sin subcontar';

export function AttestModal({ organizationId, onClose }: AttestModalProps) {
  const { t } = useI18n();
  const ar = t.accessReview;
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');

  const attest = useAccessReviewAttest({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'access-review'] });
      toast(ar.attestSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message === TRUNCATED_MESSAGE ? ar.attestTruncatedError : ar.attestError, {
        type: 'error',
      });
    },
  });

  const onSubmit = () => {
    if (attest.isPending) return;
    attest.mutate({ organizationId, notes: notes.trim() || undefined });
  };

  return (
    <Modal
      title={ar.attestModalTitle}
      description={ar.attestModalDesc}
      onClose={onClose}
      size="sm"
      dirty={notes.trim().length > 0 && !attest.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={attest.isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={onSubmit} loading={attest.isPending} loadingLabel={ar.attesting}>
            {ar.attestAction}
          </Button>
        </>
      }
    >
      <Field
        label={ar.notesLabel}
        optional
        help={formatMessage(ar.notesCount, { count: notes.length, max: MAX_NOTES })}
      >
        <TextArea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
          maxLength={MAX_NOTES}
          rows={4}
          placeholder={ar.notesPlaceholder}
          disabled={attest.isPending}
          className="resize-none"
        />
      </Field>
    </Modal>
  );
}
