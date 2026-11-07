import { z } from 'zod';

/** 32 random bytes, base64url without padding (issued by the interview scheduling email). */
export const INTERVIEW_JOIN_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const INTERVIEW_JOIN_OUTCOMES = [
  'invalid',
  'cancelled',
  'expired',
  'too_early',
  'not_video',
  'ready',
  'unavailable',
  // Only while Platform:InterviewTranscriptionEnabled is on: answer the transcription notice first.
  'consent_required',
] as const;

/** The candidate's answer to the transcription notice, posted with the token (the platform records it). */
export const RECORDING_CONSENT_DECISIONS = ['accepted', 'declined'] as const;
export type RecordingConsentDecision = (typeof RECORDING_CONSENT_DECISIONS)[number];

export const interviewJoinResultSchema = z
  .object({
    outcome: z.enum(INTERVIEW_JOIN_OUTCOMES),
    scheduledAt: z.string().max(40).nullable().optional(),
    joinOpensAt: z.string().max(40).nullable().optional(),
    joinUrl: z.string().max(4096).nullable().optional(),
    // Omitted unless transcription is on (consent_required, or ready for an interview that may be transcribed).
    consentVersion: z.string().max(64).optional(),
  })
  .strict();

export type InterviewJoinResult = z.infer<typeof interviewJoinResultSchema>;

/** The relay's error bodies (`{ error }`), so the join page can tell "not enabled" and "wait" from a failure. */
export const INTERVIEW_JOIN_RELAY_ERRORS = {
  unavailable: 'join_unavailable',
  notEnabled: 'join_not_enabled',
  rateLimited: 'rate_limited',
} as const;
export type InterviewJoinRelayError = (typeof INTERVIEW_JOIN_RELAY_ERRORS)[keyof typeof INTERVIEW_JOIN_RELAY_ERRORS];

/** Page-only outcomes derived from the relay's error answers (never sent by the platform API). */
export type InterviewJoinViewResult =
  | InterviewJoinResult
  | { outcome: 'not_enabled' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number };

/** Minimum wait between join attempts from the page; a 429 waits at least its Retry-After. */
export const JOIN_RETRY_COOLDOWN_SECONDS = 10;
export const JOIN_RETRY_MAX_WAIT_SECONDS = 120;
export type InterviewJoinOutcome = (typeof INTERVIEW_JOIN_OUTCOMES)[number];

export function isValidInterviewJoinToken(token: unknown): token is string {
  return typeof token === 'string' && INTERVIEW_JOIN_TOKEN.test(token);
}

/**
 * Only a Daily hosted meeting page may receive the candidate: https, a *.daily.co host, no credentials,
 * default port. Anything else is treated as unavailable rather than followed (no open redirect).
 */
export function isSafeDailyJoinUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    url.port === '' &&
    host.endsWith('.daily.co') &&
    host.length > '.daily.co'.length
  );
}

export type InterviewJoinRequest =
  | { token: string }
  | { token: string; recordingConsent: RecordingConsentDecision; consentVersion: string };

/**
 * The relay's strict request body: exactly `{ token }`, or exactly `{ token, recordingConsent, consentVersion }`
 * (the transcription decision). Anything else — extra keys, a bad token, an unknown decision — is null (400).
 */
export function parseInterviewJoinRequest(parsed: unknown): InterviewJoinRequest | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (!isValidInterviewJoinToken(body.token)) return null;
  if (keys.length === 1 && keys[0] === 'token') return { token: body.token };
  if (keys.join(',') !== 'consentVersion,recordingConsent,token') return null;
  const decision = body.recordingConsent;
  const version = body.consentVersion;
  if (!(RECORDING_CONSENT_DECISIONS as readonly unknown[]).includes(decision)) return null;
  if (typeof version !== 'string' || version.length === 0 || version.length > 64) return null;
  return { token: body.token, recordingConsent: decision as RecordingConsentDecision, consentVersion: version };
}

/** Splits a validated join URL (`https://<team>.daily.co/<room>?t=<token>`) into the room URL and its guest token. */
export function splitJoinUrl(joinUrl: string): { url: string; token: string | null } {
  const parsed = new URL(joinUrl);
  const token = parsed.searchParams.get('t');
  parsed.search = '';
  return { url: parsed.toString(), token };
}
