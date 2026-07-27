'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { useAccessReviewAttest } from '../../../../lib/platform-api/access-review';

interface AttestModalProps {
  organizationId: string;
  onClose: () => void;
}

const MAX_NOTES = 2000;
const TRUNCATED_MESSAGE = 'La organizacion excede 10000 usuarios; no se puede certificar automaticamente sin subcontar';

export function AttestModal({ organizationId, onClose }: AttestModalProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');

  const attest = useAccessReviewAttest({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'access-review'] });
      toast(t.accessReview.attestSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message === TRUNCATED_MESSAGE ? t.accessReview.attestTruncatedError : t.accessReview.attestError, {
        type: 'error',
      });
    },
  });

  const onSubmit = () => {
    if (attest.isPending) return;
    attest.mutate({ organizationId, notes: notes.trim() || undefined });
  };

  return (
    <Modal title={t.accessReview.attestModalTitle} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-[13px] text-[#585858]">{t.accessReview.attestModalDesc}</p>

        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.accessReview.notesLabel}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
            maxLength={MAX_NOTES}
            rows={4}
            placeholder={t.accessReview.notesPlaceholder}
            disabled={attest.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8B8B8B] text-right mt-1">
            {notes.length}/{MAX_NOTES}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={attest.isPending}
            className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={attest.isPending}
            className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {attest.isPending ? t.common.saving : t.accessReview.attestAction}
          </button>
        </div>
      </div>
    </Modal>
  );
}
