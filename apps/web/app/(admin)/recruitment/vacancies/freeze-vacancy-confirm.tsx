'use client';

import { formatMessage, useI18n } from '../../../../lib/i18n';
import { ConfirmDialog } from '../../../../components';

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
    <ConfirmDialog
      title={formatMessage(t.vacancies.confirmFreeze, { title: vacancyTitle })}
      description={t.vacancies.confirmFreezeDesc}
      confirmLabel={t.vacancies.freezeVacancyConfirm}
      confirmingLabel={t.vacancies.freezing}
      loading={isPending}
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
}
