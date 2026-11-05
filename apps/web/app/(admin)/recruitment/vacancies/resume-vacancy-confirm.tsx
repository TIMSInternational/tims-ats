'use client';

import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

interface ResumeVacancyConfirmProps {
  vacancyTitle: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

/** Confirms "Reanudar" (A-08): a frozen vacancy goes back on the careers portal and receives applications. */
export function ResumeVacancyConfirm({ vacancyTitle, onConfirm, onClose, isPending }: ResumeVacancyConfirmProps) {
  const { t } = useI18n();

  return (
    <Modal title={t.vacancies.confirmResume} onClose={onClose}>
      <p className="text-sm text-[#585858] mb-1">{vacancyTitle}</p>
      <p className="text-xs text-[#8B8B8B] mb-6">{t.vacancies.confirmResumeDesc}</p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1a5c] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.vacancies.resumeVacancy}
        </button>
      </div>
    </Modal>
  );
}
