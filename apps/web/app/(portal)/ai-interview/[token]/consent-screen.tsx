'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

export const AI_INTERVIEW_CONSENT_VERSION = 'v1';

interface ConsentScreenProps {
  candidateToken: string;
  onConsented: () => void;
}

export function ConsentScreen({ candidateToken, onConsented }: ConsentScreenProps) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  const recordConsent = trpc.aiInterview.recordConsent.useMutation({
    onSuccess: () => onConsented(),
    onError: (err) => toast(err.message),
  });

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#1F114C]/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-[#1F114C]">{t.aiInterview.consentHeading}</h1>
        </div>

        <p className="text-sm text-[#585858] leading-relaxed mb-6">{t.aiInterview.consentDisclosure}</p>

        <label className="flex items-start gap-3 cursor-pointer mb-6">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-[#D1D5DB] text-[#1F114C] focus:ring-[#1F114C]"
          />
          <span className="text-[13px] text-[#585858] leading-snug">{t.aiInterview.consentCheckbox}</span>
        </label>

        {recordConsent.error && (
          <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg mb-4">
            {recordConsent.error.message}
          </div>
        )}

        <button
          onClick={() =>
            recordConsent.mutate({
              candidateToken,
              textVersion: AI_INTERVIEW_CONSENT_VERSION,
            })
          }
          disabled={!checked || recordConsent.isPending}
          className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-sm font-semibold hover:bg-[#2d1a6e] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {recordConsent.isPending ? t.aiInterview.loading : t.aiInterview.consentAgree}
        </button>
      </div>
    </div>
  );
}
