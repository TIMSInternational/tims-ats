'use client';

import { Button } from '../../../../../../components/button';
import { useI18n } from '../../../../../../lib/i18n';

interface ApplyModalFooterProps {
  step: 1 | 2 | 3;
  submitting: boolean;
  /** The current step's "Siguiente" (steps 1–2) or "Enviar postulación" (step 3) is available. */
  canContinue: boolean;
  onBack: () => void;
  onCancel: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

const CHEVRON_LEFT = (
  <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

/**
 * The apply dialog's pinned action row: step 1 offers Cancel + Siguiente; later steps offer Anterior + the
 * primary, and closing stays on the dialog's ✕ (which asks before discarding). One primary, trailing.
 */
export function ApplyModalFooter({ step, submitting, canContinue, onBack, onCancel, onNext, onSubmit }: ApplyModalFooterProps) {
  const { t } = useI18n();
  const p = t.portal;
  return (
    <>
      {step === 1 ? (
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          {p.cancel}
        </Button>
      ) : (
        <Button variant="secondary" onClick={onBack} disabled={submitting} icon={CHEVRON_LEFT}>
          {p.previousStep}
        </Button>
      )}
      {step < 3 ? (
        <Button onClick={onNext} disabled={!canContinue}>
          {p.nextStep}
        </Button>
      ) : (
        <Button onClick={onSubmit} disabled={!canContinue} loading={submitting} loadingLabel={p.sendingShort}>
          {p.submitApplication}
        </Button>
      )}
    </>
  );
}
