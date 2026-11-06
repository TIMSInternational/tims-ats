import { z } from 'zod';

// ---------------------------------------------------------------------------
// Video-interview transcription + AI evidence (dark by default).
//
// Three independent switches, all OFF unless set to the exact string "true":
//   NEXT_PUBLIC_INTERVIEW_VIDEO_ENABLED          in-app video (existing; type 'video' offered, candidate in-app call)
//   NEXT_PUBLIC_INTERVIEW_TRANSCRIPTION_ENABLED  consent notice + transcription controls + AI card in the room
//   INTERVIEW_TRANSCRIPT_AI_ENABLED (server)     the /api/interviews/[id]/transcript-analysis route answers at all
// The C# side has its own: Platform:InterviewTranscriptionEnabled (consent step, endpoints, Daily webhook).
// The platform transcribes; it NEVER records audio or video.
// ---------------------------------------------------------------------------

/**
 * The notice version both screens show. MUST equal the C# InterviewTranscriptionConstants.ConsentTextVersion
 * (tests/interview/interview-transcription.test.ts pins the two). Bump it with the copy: older decisions stop
 * counting and everyone is asked again.
 */
export const INTERVIEW_TRANSCRIPTION_CONSENT_VERSION = 'interview-transcription-2026-11-06';

/** The in-app video switch (same exact-string rule as schedule-modal.helpers isInterviewVideoEnabled). */
export function isInAppVideoEnabled(raw: string | undefined = process.env.NEXT_PUBLIC_INTERVIEW_VIDEO_ENABLED): boolean {
  return raw === 'true';
}

/** Transcription UI needs in-app video too. Literal env references so Next inlines them into the client bundle. */
export function isInterviewTranscriptionUiEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_INTERVIEW_TRANSCRIPTION_ENABLED,
  videoEnabled: boolean = isInAppVideoEnabled(),
): boolean {
  return videoEnabled && raw === 'true';
}

export const TRANSCRIPTION_LANGUAGES = ['es', 'en'] as const;
export type TranscriptionLanguage = (typeof TRANSCRIPTION_LANGUAGES)[number];

export const CANDIDATE_DECISIONS = ['accepted', 'declined', 'pending'] as const;
export const TRANSCRIPT_STATES = ['none', 'requested', 'in_progress', 'ready', 'error', 'rejected'] as const;
export type TranscriptState = (typeof TRANSCRIPT_STATES)[number];

/** GET/POST /tenant/interviews/{id}/transcription* — re-validated, nothing beyond the documented shape. */
export const transcriptionStatusSchema = z
  .object({
    consentVersion: z.string().max(64),
    candidateDecision: z.enum(CANDIDATE_DECISIONS),
    candidateDecidedAt: z.string().max(40).nullable(),
    viewerAcknowledged: z.boolean(),
    transcriptState: z.enum(TRANSCRIPT_STATES),
    transcriptAvailable: z.boolean(),
    canStart: z.boolean(),
  })
  .strict();
export type TranscriptionStatus = z.infer<typeof transcriptionStatusSchema>;

/** GET /tenant/interviews/{id}/transcript (C#) — the AI route's input. Speakers are roles, never names. */
export const transcriptViewSchema = z
  .object({
    organizationId: z.string().uuid(),
    interviewId: z.string().uuid(),
    vacancyTitle: z.string().max(300).nullable(),
    language: z.enum(TRANSCRIPTION_LANGUAGES),
    competencies: z
      .array(z.object({ name: z.string().min(1).max(100), level: z.number().int().min(1).max(5).nullable() }).strict())
      .max(20),
    segments: z
      .array(
        z
          .object({
            startSeconds: z.number().int().min(0).max(86_400),
            speaker: z.string().regex(/^(candidate|unknown|interviewer_\d{1,2}|participant_\d{1,2})$/),
            text: z.string().max(1_200),
          })
          .strict(),
      )
      .max(1_500),
    truncated: z.boolean(),
  })
  .strict();
export type TranscriptView = z.infer<typeof transcriptViewSchema>;

const evidenceSchema = z.object({ quote: z.string().max(200), atSeconds: z.number().int().min(0) }).strict();

/** POST /api/interviews/[id]/transcript-analysis — what the room's AI card renders. */
export const transcriptAnalysisSchema = z
  .object({
    summary: z.string().max(4_000),
    questions: z
      .array(
        z
          .object({
            question: z.string().max(240),
            askedAtSeconds: z.number().int().min(0),
            answerSummary: z.string().max(300),
            answerQuote: z.string().max(200).nullable(),
          })
          .strict(),
      )
      .max(40),
    competencies: z
      .array(
        z
          .object({
            key: z.string().max(80),
            label: z.string().max(100),
            suggestedRating: z.number().int().min(1).max(5).nullable(),
            rationale: z.string().max(350),
            evidence: z.array(evidenceSchema).max(4),
          })
          .strict(),
      )
      .max(20),
    limitations: z.array(z.string().max(300)).max(8),
    degraded: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
export type TranscriptAnalysisView = z.infer<typeof transcriptAnalysisSchema>;

/** mm:ss, or h:mm:ss past an hour. */
export function formatTranscriptTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h > 0
    ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
    : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}
