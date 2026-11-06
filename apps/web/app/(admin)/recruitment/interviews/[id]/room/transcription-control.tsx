'use client';

import { useState } from 'react';
import { useTranscription } from '@daily-co/daily-react';
import { useI18n } from '../../../../../../lib/i18n';
import {
  transcriptionErrorCode,
  useStartTranscription,
  useTranscriptionStatus,
} from '../../../../../../lib/platform-api/interview-transcription';
import {
  TRANSCRIPTION_LANGUAGES,
  type TranscriptState,
  type TranscriptionLanguage,
} from '../../../../../../lib/interview-transcription';

const STATE_KEYS = {
  none: 'stateNone',
  requested: 'stateRequested',
  in_progress: 'stateInProgress',
  ready: 'stateReady',
  error: 'stateError',
  rejected: 'stateRejected',
} as const satisfies Record<TranscriptState, string>;

const ERROR_KEYS: Record<
  string,
  'errorCandidateConsent' | 'errorAcknowledgement' | 'errorNoRoom' | 'errorClosed' | 'errorProvider'
> = {
  candidate_consent_missing: 'errorCandidateConsent',
  acknowledgement_missing: 'errorAcknowledgement',
  no_platform_room: 'errorNoRoom',
  interview_closed: 'errorClosed',
  provider_failed: 'errorProvider',
  provider_unavailable: 'errorProvider',
};

/**
 * In-call transcription bar (inside DailyProvider). Shows the candidate's decision and the transcript state, and
 * starts the TRANSCRIPT on the server — which re-checks the candidate's consent and this evaluator's
 * acknowledgement. Nothing here can start a recording.
 */
export function TranscriptionControl({ interviewId }: { interviewId: string }) {
  const { t } = useI18n();
  const copy = t.interviewTranscription;
  const status = useTranscriptionStatus(interviewId, { enabled: true, pollMs: 15_000 });
  const start = useStartTranscription(interviewId);
  const { isTranscribing } = useTranscription();
  const [language, setLanguage] = useState<TranscriptionLanguage>('es');

  if (status.isError) {
    return <p className="text-[11px] text-white/70">{copy.statusUnavailable}</p>;
  }
  const data = status.data;
  if (!data) return null;

  const decisionText =
    data.candidateDecision === 'accepted'
      ? copy.candidateAccepted
      : data.candidateDecision === 'declined'
        ? copy.candidateDeclined
        : copy.candidatePending;
  const errorCode = start.isError ? transcriptionErrorCode(start.error) : undefined;
  const errorText = start.isError ? copy[(errorCode && ERROR_KEYS[errorCode]) || 'errorGeneric'] : null;
  const live = isTranscribing || data.transcriptState === 'in_progress';

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-white" data-testid="transcription-control">
      <span className="rounded-full bg-black/50 px-2 py-1">{decisionText}</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-1" role="status">
        {live && <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-red-500" />}
        {live ? copy.live : copy[STATE_KEYS[data.transcriptState]]}
      </span>
      {data.canStart && !live && (
        <>
          <label className="sr-only" htmlFor="transcription-language">
            {copy.languageLabel}
          </label>
          <select
            id="transcription-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as TranscriptionLanguage)}
            className="rounded bg-black/60 px-1 py-1 text-white"
          >
            {TRANSCRIPTION_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l === 'es' ? copy.languageEs : copy.languageEn}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => start.mutate(language)}
            disabled={start.isPending}
            className="rounded-full bg-[#DD0C15] px-3 py-1 font-medium hover:bg-[#c00b13] disabled:opacity-50"
          >
            {start.isPending ? copy.starting : copy.start}
          </button>
        </>
      )}
      {errorText && (
        <p role="alert" className="w-full text-red-300">
          {errorText}
        </p>
      )}
    </div>
  );
}
