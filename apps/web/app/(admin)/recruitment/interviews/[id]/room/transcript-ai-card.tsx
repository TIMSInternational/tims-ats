'use client';

import { useMutation } from '@tanstack/react-query';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import {
  requestTranscriptAnalysis,
  useTranscriptionStatus,
} from '../../../../../../lib/platform-api/interview-transcription';
import { PlatformApiError } from '../../../../../../lib/platform-api/client';
import type { ScorecardSuggestion } from './scorecard-suggestion';
import { TranscriptAiResult } from './transcript-ai-result';

type ErrorKey =
  | 'errorBudget'
  | 'errorTranscriptNotReady'
  | 'errorCandidateConsent'
  | 'errorForbidden'
  | 'errorAiUnavailable';

/** Maps the route's / platform's stable answer to copy. Unknown → "AI unavailable" (never raw server text). */
export function transcriptAnalysisErrorKey(error: unknown): ErrorKey {
  if (!(error instanceof PlatformApiError)) return 'errorAiUnavailable';
  if (error.status === 429) return 'errorBudget';
  if (error.code === 'transcript_not_ready') return 'errorTranscriptNotReady';
  if (error.code === 'candidate_consent_missing') return 'errorCandidateConsent';
  if (error.status === 401 || error.status === 403 || error.status === 404) return 'errorForbidden';
  return 'errorAiUnavailable';
}

interface TranscriptAiCardProps {
  interviewId: string;
  onApply?: (suggestion: Omit<ScorecardSuggestion, 'id'>) => void;
}

/**
 * "Sugerencia de IA — la decisión es del evaluador": runs ONLY on a button press (it spends the org's AI budget),
 * never stores anything, and every suggestion shows the verbatim evidence it rests on.
 */
export function TranscriptAiCard({ interviewId, onApply }: TranscriptAiCardProps) {
  const { t } = useI18n();
  const copy = t.interviewTranscription;
  const status = useTranscriptionStatus(interviewId, { enabled: true });
  const analysis = useMutation({
    mutationFn: () => requestTranscriptAnalysis(interviewId),
    onError: (error) => toast(copy[transcriptAnalysisErrorKey(error)], { type: 'error' }),
  });
  const ready = status.data?.transcriptAvailable === true;

  return (
    <div className="rounded-lg border border-[#EDEDED] bg-white p-3" data-testid="transcript-ai-card">
      <h4 className="text-[12px] font-semibold text-[#1F114C]">{copy.aiHeading}</h4>
      <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800" role="note">
        {copy.aiDisclaimer}
      </p>
      <p className="mt-1 text-[10px] text-[#8B8B8B]">{copy.aiExplain}</p>
      {ready ? (
        <button
          type="button"
          onClick={() => analysis.mutate()}
          disabled={analysis.isPending}
          className="mt-2 w-full flex items-center justify-center gap-2 bg-[#1F114C] text-white py-2.5 rounded-lg text-[12px] font-medium hover:bg-[#2a1866] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analysis.isPending && (
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
          {analysis.isPending ? copy.analyzing : copy.analyze}
        </button>
      ) : (
        <p className="mt-2 text-[11px] text-[#8B8B8B]">{status.isError ? copy.statusUnavailable : copy.notReady}</p>
      )}
      {analysis.isError && (
        <p role="alert" className="mt-2 text-[11px] text-red-600">
          {copy[transcriptAnalysisErrorKey(analysis.error)]}
        </p>
      )}
      {analysis.data?.degraded && <p className="mt-2 text-[11px] text-amber-700">{copy.degraded}</p>}
      {analysis.data && <TranscriptAiResult analysis={analysis.data} onApply={onApply} />}
    </div>
  );
}
