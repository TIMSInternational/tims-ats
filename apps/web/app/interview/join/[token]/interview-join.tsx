'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { CANDIDATE_INTL_LOCALE } from '../../../../lib/candidate-format';
import {
  INTERVIEW_JOIN_RELAY_ERRORS,
  JOIN_RETRY_COOLDOWN_SECONDS,
  JOIN_RETRY_MAX_WAIT_SECONDS,
  interviewJoinResultSchema,
  isSafeDailyJoinUrl,
  isValidInterviewJoinToken,
  type InterviewJoinViewResult,
  type RecordingConsentDecision,
} from '../../../../lib/interview-join';
import { INTERVIEW_TRANSCRIPTION_CONSENT_VERSION, isInAppVideoEnabled } from '../../../../lib/interview-transcription';
import { TranscriptionConsent } from './transcription-consent';
import { CandidateCall } from './candidate-call';

type ViewState =
  | { kind: 'checking' }
  | { kind: 'redirecting' }
  | { kind: 'consent'; saving: boolean }
  | { kind: 'call'; joinUrl: string; attempt: number; decision: RecordingConsentDecision | null }
  | { kind: 'result'; result: InterviewJoinViewResult };

async function requestJoin(token: string, decision: RecordingConsentDecision | null): Promise<InterviewJoinViewResult> {
  const response = await fetch('/api/interview-join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The decision travels with the notice version it answered; the platform records both before any room opens.
    body: JSON.stringify(
      decision ? { token, recordingConsent: decision, consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION } : { token },
    ),
    cache: 'no-store',
    credentials: 'omit',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    if (response.status === 429 || error === INTERVIEW_JOIN_RELAY_ERRORS.rateLimited) {
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      return { outcome: 'rate_limited', retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60 };
    }
    if (error === INTERVIEW_JOIN_RELAY_ERRORS.notEnabled) return { outcome: 'not_enabled' };
    return { outcome: 'unavailable' };
  }
  const parsed = interviewJoinResultSchema.safeParse(body);
  return parsed.success ? parsed.data : { outcome: 'unavailable' };
}

/** Seconds the Retry button stays disabled after an answer: a floor for every retry, Retry-After for a 429. */
function cooldownFor(result: InterviewJoinViewResult): number {
  const wait = result.outcome === 'rate_limited' ? result.retryAfterSeconds : JOIN_RETRY_COOLDOWN_SECONDS;
  return Math.min(Math.max(wait, JOIN_RETRY_COOLDOWN_SECONDS), JOIN_RETRY_MAX_WAIT_SECONDS);
}

/**
 * Candidate-facing join screen: resolves the emailed link, asks for the transcription decision when the platform
 * requires it, then opens the call IN the platform (in-app video on) or hands off to the Daily hosted room.
 */
export function InterviewJoin({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const copy = t.interviewJoin;
  const [state, setState] = useState<ViewState>({ kind: 'checking' });
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);
  // Kept for the whole visit: a rejoin re-sends the same answer instead of asking again.
  const decision = useRef<RecordingConsentDecision | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const check = useCallback(async () => {
    if (!isValidInterviewJoinToken(token)) {
      setState({ kind: 'result', result: { outcome: 'invalid' } });
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setState((current) => (current.kind === 'consent' ? { kind: 'consent', saving: true } : { kind: 'checking' }));
    const result = await requestJoin(token, decision.current)
      .catch((): InterviewJoinViewResult => ({ outcome: 'unavailable' }))
      .finally(() => {
        inFlight.current = false;
      });
    setCooldown(cooldownFor(result));
    if (result.outcome === 'consent_required') {
      // A notice version this page does not know (deploy skew) cannot be consented to honestly.
      decision.current = null;
      setState(
        result.consentVersion === INTERVIEW_TRANSCRIPTION_CONSENT_VERSION
          ? { kind: 'consent', saving: false }
          : { kind: 'result', result: { outcome: 'unavailable' } },
      );
      return;
    }
    if (result.outcome === 'ready') {
      if (isSafeDailyJoinUrl(result.joinUrl)) {
        if (isInAppVideoEnabled()) {
          setState({ kind: 'call', joinUrl: result.joinUrl, attempt: ++attempts.current, decision: decision.current });
          return;
        }
        setState({ kind: 'redirecting' });
        window.location.assign(result.joinUrl);
        return;
      }
      setState({ kind: 'result', result: { outcome: 'unavailable' } });
      return;
    }
    setState({ kind: 'result', result });
  }, [token]);

  useEffect(() => {
    void check();
  }, [check]);

  const decide = (answer: RecordingConsentDecision) => {
    decision.current = answer;
    void check();
  };

  if (state.kind === 'consent') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F6F6F6] px-4 py-12">
        <TranscriptionConsent isSaving={state.saving} onDecide={decide} />
      </main>
    );
  }
  if (state.kind === 'call') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <CandidateCall key={state.attempt} joinUrl={state.joinUrl} decision={state.decision} onRejoin={() => void check()} />
      </main>
    );
  }

  const format = (iso: string | null | undefined) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(CANDIDATE_INTL_LOCALE[locale], {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(date);
  };

  let title = copy.checking;
  let text = '';
  let details: { label: string; value: string }[] = [];
  let canRetry = false;
  if (state.kind === 'redirecting') title = copy.redirecting;
  if (state.kind === 'result') {
    const { result } = state;
    const messages = {
      too_early: [copy.tooEarlyTitle, copy.tooEarlyText],
      expired: [copy.expiredTitle, copy.expiredText],
      cancelled: [copy.cancelledTitle, copy.cancelledText],
      invalid: [copy.invalidTitle, copy.invalidText],
      not_video: [copy.notVideoTitle, copy.notVideoText],
      unavailable: [copy.unavailableTitle, copy.unavailableText],
      ready: [copy.unavailableTitle, copy.unavailableText],
      consent_required: [copy.unavailableTitle, copy.unavailableText],
      not_enabled: [copy.notEnabledTitle, copy.notEnabledText],
      rate_limited: [copy.rateLimitedTitle, copy.rateLimitedText],
    } as const;
    [title, text] = messages[result.outcome];
    canRetry = ['too_early', 'unavailable', 'rate_limited', 'not_enabled'].includes(result.outcome);
    if (result.outcome === 'too_early') {
      details = [
        { label: copy.scheduledFor, value: format(result.scheduledAt) },
        { label: copy.opensAt, value: format(result.joinOpensAt) },
      ].filter((detail) => detail.value);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F6F6F6] px-4 py-12">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">{copy.title}</p>
        <h1 className="mt-3 text-xl font-semibold text-[#1F114C]">{title}</h1>
        {text && <p className="mt-3 text-sm text-slate-600">{text}</p>}
        {details.length > 0 && (
          <dl className="mt-6 space-y-3 rounded-xl bg-slate-50 p-4 text-left text-sm">
            {details.map((detail) => (
              <div key={detail.label}>
                <dt className="text-slate-500">{detail.label}</dt>
                <dd className="font-medium text-slate-800">{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={() => void check()}
            disabled={cooldown > 0}
            className="mt-6 w-full rounded-xl bg-[#1F114C] px-4 py-3 text-sm font-semibold text-white hover:bg-violet-900 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cooldown > 0 ? copy.retryIn.replace('{seconds}', String(cooldown)) : copy.retry}
          </button>
        )}
        <p className="mt-6 text-xs text-slate-400">{copy.privacy}</p>
      </section>
    </main>
  );
}
