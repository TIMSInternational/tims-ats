'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Modal } from '../../../../../components';

interface RejectModalProps {
  onConfirm: (comment: string) => void;
  onClose: () => void;
  isPending: boolean;
}

export function RejectModal({ onConfirm, onClose, isPending }: RejectModalProps) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');

  return (
    <Modal title={t.vacancies.rejectConfirmTitle} onClose={onClose}>
      <p className="text-xs text-[#8B8B8B] mb-4">{t.vacancies.rejectConfirmDesc}</p>

      <div>
        <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.rejectReason} *</label>
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t.vacancies.rejectReasonPlaceholder}
          maxLength={1000}
          className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
          autoFocus
        />
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
          {t.common.cancel}
        </button>
        <button
          onClick={() => onConfirm(comment)}
          disabled={!comment.trim() || isPending}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.vacancies.rejectStep}
        </button>
      </div>
    </Modal>
  );
}
