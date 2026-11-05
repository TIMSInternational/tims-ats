'use client';

import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

interface FreezeVacancyConfirmProps {
  vacancyTitle: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

/** Confirms "Congelar": the vacancy leaves the careers portal until someone resumes it ("Reanudar"). */
export function FreezeVacancyConfirm({ vacancyTitle, onConfirm, onClose, isPending }: FreezeVacancyConfirmProps) {
  const { t } = useI18n();

  return (
    <Modal title={t.vacancies.confirmFreeze} onClose={onClose}>
      <p className="text-sm text-[#585858] mb-1">{vacancyTitle}</p>
      <p className="text-xs text-[#8B8B8B] mb-6">{t.vacancies.confirmFreezeDesc}</p>
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
          className="h-9 px-5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.vacancies.freezeVacancy}
        </button>
      </div>
    </Modal>
  );
}
