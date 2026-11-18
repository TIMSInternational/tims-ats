'use client';

import { formatMessage, useI18n } from '../../../../lib/i18n';
import { ConfirmDialog } from '../../../../components';

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
    <ConfirmDialog
      title={formatMessage(t.vacancies.confirmResume, { title: vacancyTitle })}
      description={t.vacancies.confirmResumeDesc}
      confirmLabel={t.vacancies.resumeVacancy}
      confirmingLabel={t.vacancies.resuming}
      loading={isPending}
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
}
