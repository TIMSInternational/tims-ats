'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../../../lib/i18n';
import { Button, CHOICE_INPUT_CLASSES } from '../../../../../../../../components';

interface AssessmentConsentGateProps {
  onStart: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

export function AssessmentConsentGate({ onStart, isSubmitting, errorMessage }: AssessmentConsentGateProps) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-lg space-y-5 rounded-2xl bg-white p-6 shadow-card sm:p-8">
        <h1 className="font-display text-title font-semibold text-brand">{t.assessmentPlayer.consentTitle}</h1>
        <p className="max-w-prose whitespace-pre-line text-body leading-relaxed text-secondary">
          {t.assessmentPlayer.consentBody}
        </p>
        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
          />
          <span className="text-body text-primary">{t.assessmentPlayer.consentCheckboxLabel}</span>
        </label>
        {errorMessage && (
          <p role="alert" className="flex items-start gap-1 text-callout text-danger">
            <ErrorIcon />
            <span>{errorMessage}</span>
          </p>
        )}
        <Button
          size="lg"
          fullWidth
          onClick={onStart}
          disabled={!checked}
          loading={isSubmitting}
          loadingLabel={t.assessmentPlayer.consentStarting}
        >
          {t.assessmentPlayer.consentStartButton}
        </Button>
      </div>
    </div>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="mt-px size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
    </svg>
  );
}
