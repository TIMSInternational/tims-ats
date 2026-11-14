'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button } from '../../../../components';
import type { Step } from './create-modal.helpers';

interface WizardFooterProps {
  step: Step;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  nextDisabled: boolean;
  submitDisabled: boolean;
  isPending: boolean;
}

// "Cancelar" goes through the Modal's own close request (Escape), so it gets the same unsaved-changes guard
// as the ✕, the backdrop and the Escape key.
const requestModalClose = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

/**
 * The wizard's sticky action row (sheets.md: never Cancel, Back and Next together). Step 1 offers Cancel; later
 * steps offer Back (the ✕ still cancels). One primary, trailing: Siguiente, then Crear vacante.
 */
export function WizardFooter({
  step,
  onBack,
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
        <Button variant="secondary" onClick={requestModalClose}>
          {t.common.cancel}
        </Button>
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
