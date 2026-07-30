'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../../../lib/i18n';

interface AssessmentConsentGateProps {
  onStart: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

export function AssessmentConsentGate({ onStart, isSubmitting, errorMessage }: AssessmentConsentGateProps) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full space-y-5">
        <h1 className="text-lg font-semibold text-[#1F114C]">{t.assessmentPlayer.consentTitle}</h1>
        <p className="text-[13px] text-[#585858] leading-relaxed whitespace-pre-line">
          {t.assessmentPlayer.consentBody}
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[#D1D5DB] text-[#1F114C] focus:ring-[#1F114C]"
          />
          <span className="text-[13px] text-[#585858]">{t.assessmentPlayer.consentCheckboxLabel}</span>
        </label>
        {errorMessage && <p className="text-[12px] text-[#B42318]">{errorMessage}</p>}
        <button
          type="button"
          onClick={onStart}
          disabled={!checked || isSubmitting}
          className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-sm font-semibold hover:bg-[#2a1a5e] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? t.assessmentPlayer.consentStarting : t.assessmentPlayer.consentStartButton}
        </button>
      </div>
    </div>
  );
}
