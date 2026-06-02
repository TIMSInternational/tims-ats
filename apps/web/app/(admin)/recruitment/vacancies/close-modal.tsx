'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

interface CloseModalProps {
  vacancyTitle: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  isPending: boolean;
}

export function CloseModal({ vacancyTitle, onConfirm, onClose, isPending }: CloseModalProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');

  return (
    <Modal title={t.vacancies.confirmClose} onClose={onClose}>
      <p className="text-sm text-[#585858] mb-1">{vacancyTitle}</p>
      <p className="text-xs text-[#8B8B8B] mb-4">{t.vacancies.confirmCloseDesc}</p>

      <div>
        <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.closeReason} *</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t.vacancies.closeReasonPlaceholder}
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
          onClick={() => onConfirm(reason)}
          disabled={!reason.trim() || isPending}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.vacancies.closeVacancy}
        </button>
      </div>
    </Modal>
  );
}
