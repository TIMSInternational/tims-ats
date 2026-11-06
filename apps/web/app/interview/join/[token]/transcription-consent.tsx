'use client';

import { useI18n } from '../../../../lib/i18n';
import type { RecordingConsentDecision } from '../../../../lib/interview-join';

interface TranscriptionConsentProps {
  /** True while the decision is being recorded: both buttons are disabled. */
  isSaving: boolean;
  onDecide: (decision: RecordingConsentDecision) => void;
}

/**
 * The candidate's transcription notice, shown BEFORE any room or token exists. Both answers join the call; the
 * platform records which one was given (and the notice version) before the call opens. Declining is as easy as
 * accepting and is never penalized.
 */
export function TranscriptionConsent({ isSaving, onDecide }: TranscriptionConsentProps) {
  const { t } = useI18n();
  const copy = t.interviewJoinTranscription;
  return (
    <section
      aria-labelledby="transcription-consent-title"
      className="w-full max-w-lg rounded-2xl bg-white p-8 text-left shadow-sm"
    >
      <h1 id="transcription-consent-title" className="text-xl font-semibold text-[#1F114C]">
        {copy.consentTitle}
      </h1>
      <div className="mt-4 space-y-3 text-sm text-slate-700">
        <p>{copy.consentIntro}</p>
        <p>{copy.consentPurpose}</p>
        <p>{copy.consentLimits}</p>
        <p>{copy.consentRetention}</p>
        <p>{copy.consentRights}</p>
        <p className="font-medium text-slate-800">{copy.consentFree}</p>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => onDecide('accepted')}
          disabled={isSaving}
          className="w-full rounded-xl bg-[#1F114C] px-4 py-3 text-sm font-semibold text-white hover:bg-violet-900 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copy.accept}
        </button>
        <button
          type="button"
          onClick={() => onDecide('declined')}
          disabled={isSaving}
          className="w-full rounded-xl border border-[#1F114C] px-4 py-3 text-sm font-semibold text-[#1F114C] hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copy.decline}
        </button>
        {isSaving && (
          <p role="status" className="text-center text-xs text-slate-500">
            {copy.saving}
          </p>
        )}
      </div>
    </section>
  );
}
