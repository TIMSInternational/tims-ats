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
} from '../../../../lib/interview-join';
import { Button } from '../../../../components/button';

type ViewState = { kind: 'checking' } | { kind: 'redirecting' } | { kind: 'result'; result: InterviewJoinViewResult };

async function requestJoin(token: string): Promise<InterviewJoinViewResult> {
  const response = await fetch('/api/interview-join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
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

/** Candidate-facing join screen: resolves the emailed link, then hands off to the Daily hosted room. */
export function InterviewJoin({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const copy = t.interviewJoin;
  const [state, setState] = useState<ViewState>({ kind: 'checking' });
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);

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
    setState({ kind: 'checking' });
    const result = await requestJoin(token)
      .catch((): InterviewJoinViewResult => ({ outcome: 'unavailable' }))
      .finally(() => {
        inFlight.current = false;
      });
    setCooldown(cooldownFor(result));
    if (result.outcome === 'ready') {
      if (isSafeDailyJoinUrl(result.joinUrl)) {
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
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-12">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-card sm:p-8" aria-labelledby="interview-join-title">
        <p className="text-callout font-semibold uppercase tracking-wide text-brand">{copy.title}</p>
        {/* Only the state message is a live region: the retry countdown is not announced every second. */}
        <div role="status" aria-live="polite">
          <h1 id="interview-join-title" className="mt-3 font-display text-title font-semibold text-brand">{title}</h1>
          {text && <p className="mx-auto mt-3 max-w-prose text-base text-secondary sm:text-body">{text}</p>}
        </div>
        {details.length > 0 && (
          <dl className="mt-6 space-y-3 rounded-xl bg-surface p-4 text-left text-base sm:text-body">
            {details.map((detail) => (
              <div key={detail.label}>
                <dt className="text-secondary">{detail.label}</dt>
                <dd className="font-medium text-primary tabular-nums">{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {canRetry && (
          <Button size="lg" fullWidth className="mt-6" onClick={() => void check()} disabled={cooldown > 0}>
            {cooldown > 0 ? copy.retryIn.replace('{seconds}', String(cooldown)) : copy.retry}
          </Button>
        )}
        <p className="mt-6 text-callout text-muted">{copy.privacy}</p>
      </section>
    </main>
  );
}
