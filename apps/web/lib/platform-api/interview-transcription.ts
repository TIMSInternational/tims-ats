'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import {
  INTERVIEW_TRANSCRIPTION_CONSENT_VERSION,
  isInterviewTranscriptionUiEnabled,
  transcriptAnalysisSchema,
  transcriptionStatusSchema,
  type TranscriptAnalysisView,
  type TranscriptionLanguage,
  type TranscriptionStatus,
} from '../interview-transcription';
import { isPlatformApiEnabled, platformGet, platformPost, PlatformApiError } from './client';

// Interview transcription lives ONLY in C# (no tRPC twin): the room shows it when the UI flag is on and the C#
// base URL is configured. Every answer is re-validated before the UI trusts it.

export function isTranscriptionAvailable(): boolean {
  return isInterviewTranscriptionUiEnabled() && isPlatformApiEnabled();
}

const statusKey = (interviewId: string) => ['interview-transcription', interviewId] as const;

export function useTranscriptionStatus(interviewId: string, options: { enabled: boolean; pollMs?: number }) {
  return useQuery({
    queryKey: statusKey(interviewId),
    enabled: options.enabled && isTranscriptionAvailable(),
    refetchInterval: options.pollMs ?? false,
    retry: false,
    queryFn: async (): Promise<TranscriptionStatus> =>
      transcriptionStatusSchema.parse(
        await platformGet('/tenant/interviews/{interviewId}/transcription', undefined, { interviewId }),
      ),
  });
}

/**
 * The evaluator's acknowledgement of the notice, recorded server-side. A plain call (no React Query hook) so the
 * room page needs no query client while the feature is dark; the in-call status poll picks the result up.
 */
export async function acknowledgeTranscription(interviewId: string): Promise<TranscriptionStatus> {
  return transcriptionStatusSchema.parse(
    await platformPost(
      '/tenant/interviews/{interviewId}/transcription/acknowledgement',
      { consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION },
      { interviewId },
    ),
  );
}

export function useStartTranscription(interviewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (language: TranscriptionLanguage): Promise<TranscriptionStatus> =>
      transcriptionStatusSchema.parse(
        await platformPost('/tenant/interviews/{interviewId}/transcription/start', { language }, { interviewId }),
      ),
    onSuccess: (status) => queryClient.setQueryData(statusKey(interviewId), status),
  });
}

/** Stable error codes the C# handlers return (`{ code, message }`), mapped to i18n by the caller. */
export function transcriptionErrorCode(error: unknown): string | undefined {
  return error instanceof PlatformApiError ? error.code : undefined;
}

/**
 * Runs the advisory AI analysis (apps/web route → C# transcript → packages/ai invokeAgent). The bearer is the
 * evaluator's own session; the route forwards it to C#, which authorizes and scopes the read.
 */
export async function requestTranscriptAnalysis(interviewId: string): Promise<TranscriptAnalysisView> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(`/api/interviews/${encodeURIComponent(interviewId)}/transcript-analysis`, {
    method: 'POST',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new PlatformApiError(response.status, response.statusText, body);
  return transcriptAnalysisSchema.parse(body);
}
