'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button, DialogCancelButton } from '../../../../components';
import type { Step } from './create-modal.helpers';

interface WizardFooterProps {
  step: Step;
  onBack: () => void;
  /** Fallback outside a Modal; inside one, Cancel goes through the Modal's dirty guard. */
  onCancel: () => void;
  onNext: () => void;
  onSubmit: () => void;
  nextDisabled: boolean;
  submitDisabled: boolean;
  isPending: boolean;
}

/**
 * The wizard's sticky action row (sheets.md: never Cancel, Back and Next together). Step 1 offers Cancel; later
 * steps offer Back (the ✕ still cancels). One primary, trailing: Siguiente, then Crear vacante.
 */
export function WizardFooter({
  step,
  onBack,
  onCancel,
  onNext,
  onSubmit,
  nextDisabled,
  submitDisabled,
  isPending,
}: WizardFooterProps) {
  const { t } = useI18n();
  return (
    <>
      {step === 1 ? (
        <DialogCancelButton onCancel={onCancel} />
      ) : (
        <Button variant="secondary" onClick={onBack}>
          {t.common.back}
        </Button>
      )}
      {step < 3 ? (
        <Button onClick={onNext} disabled={nextDisabled}>
          {t.common.next}
        </Button>
      ) : (
        <Button
          onClick={onSubmit}
          disabled={submitDisabled}
          loading={isPending}
          loadingLabel={t.vacancies.creatingVacancy}
        >
          {t.vacancies.createVacancySubmit}
        </Button>
      )}
    </>
  );
}
