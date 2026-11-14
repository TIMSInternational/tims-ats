'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { PlatformApiError } from '../../../../../lib/platform-api/client';
import {
  launchProviderAttempt,
  providerAttemptsKey,
  useMyProviderAssessments,
  type ConsentDecision,
  type PortalProviderAttempt,
  type PortalStatus,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { canEmbedPlayer, chooseLaunchTarget, openTopLevel } from '../../../../../lib/assessment-player-launch';
import { ProviderAssessmentFrame } from './provider-assessment-frame';
import { frameMessages } from './provider-frame-messages';
import { ProviderAssessmentItem, portalInstrumentName, type PortalMessages } from './provider-assessment-item';

// "Online assessments": the candidate's assessments run by the TIMS Assessments provider (AS-5, D16), next to the
// native quizzes of DashboardAssessments. Read from the C# portal routes, dark unless
// NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP is on. Each entry shows one coarse status (D9: never a review or validity
// state) and, when launchable, opens the launch's hosted URL: framed only when the player's registered frame ancestors
// include this site and its origin is the configured player origin; otherwise a top-level link-out. The URL carries a
// single-use launch code: it is opened at once and never stored, logged or shown.
const PLAYER_ORIGIN = process.env.NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN;
// PCA is answered on the provider's own site: framed (sandboxed) when that site is the configured provider frame origin,
// as timssuite.com frames it; otherwise a top-level link-out.
const PROVIDER_FRAME_ORIGIN = process.env.NEXT_PUBLIC_ASSESSMENT_PROVIDER_FRAME_ORIGIN;
/** timssuite.com checks its PCA page's survey every 15 s. */
export const PCA_POLL_MS = 15_000;
/** After a sitting ends, re-read every 2 s for at most 60 s until its result has arrived. */
export const SETTLE_POLL_MS = 2_000;
const SETTLE_MAX_MS = 60_000;
const INSTRUMENT_ORDER: Record<string, number> = { lia: 0, english: 1, personality: 2, pca: 3 };
const FINISHED_STATUSES = new Set<PortalStatus>(['completed', 'needs_review', 'expired']);

/** The message for a failed launch, from the route's stable code (or its status). */
export function launchErrorKey(error: unknown): keyof PortalMessages {
  if (error instanceof PlatformApiError) {
    if (error.code === 'consent_withdrawn') return 'providerLaunchWithdrawn';
    if (error.code === 'attempt_expired' || error.status === 410) return 'providerLaunchExpired';
    if (error.code === 'consent_required') return 'providerLaunchConsentRequired';
  }
  return 'providerLaunchError';
}

export function DashboardProviderAssessments({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [frame, setFrame] = useState<{
    url: string;
    sandboxed: boolean;
    instrument: string;
    attemptId: string;
    /** The test's language: the frame's bar follows it. */
    locale: string;
    /** The player said the sitting ended (its receipt is on screen). */
    finished?: boolean;
  } | null>(null);
  // The result reaches the ATS by the suite's webhook moments after the sitting ends, so the list is re-read until the
  // attempt leaves "in progress" (not just once): otherwise the dashboard can keep offering "Continue" for a finished
  // test. A framed PCA (TIMS's page sends no message) is polled as timssuite.com polls it.
  const [settling, setSettling] = useState<{ attemptId: string; until: number } | null>(null);
  const { data, isLoading, isError } = useMyProviderAssessments(orgSlug, {
    pollMs: settling ? SETTLE_POLL_MS : frame?.sandboxed ? PCA_POLL_MS : false,
  });
  // The same (cached) read as "My applications": the consent notice names the vacancy of each assessment.
  const applications = trpc.candidatePortal.myApplications.useQuery({ orgSlug });
  const vacancyTitles = new Map((applications.data ?? []).map((a) => [a.vacancy.id, a.vacancy.title]));
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ attemptId: string; key: keyof PortalMessages } | null>(null);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: providerAttemptsKey(orgSlug) }),
    [queryClient, orgSlug],
  );

  const start = async (attempt: PortalProviderAttempt, decision: ConsentDecision) => {
    const { attemptId } = attempt;
    setBusy(attemptId);
    setFailure(null);
    try {
      // Ask for an embedded launch (no return URL) only when the player could be framed at all: a native instrument and
      // a configured player origin. Whether THIS origin is a registered frame ancestor is known only from the launch.
      const embedded = attempt.delivery === 'native' && canEmbedPlayer(PLAYER_ORIGIN);
      let launch = await launchProviderAttempt(attemptId, decision, embedded);
      let target = chooseLaunchTarget(launch, window.location.origin, PLAYER_ORIGIN, PROVIDER_FRAME_ORIGIN);
      if (embedded && target.kind === 'navigate') {
        // It cannot be framed after all: launch again for a top-level sitting, so the player returns the candidate to
        // this dashboard. A new launch revokes the first, unused launch code; consents (and declined optional purposes)
        // were recorded by the first.
        launch = await launchProviderAttempt(attemptId, { accepted: [], declined: [], notice: decision.notice }, false);
        target = chooseLaunchTarget(launch, window.location.origin, PLAYER_ORIGIN);
        if (target.kind === 'iframe') target = { kind: 'navigate', url: target.url };
      }
      setConsentFor(null);
      if (target.kind === 'iframe')
        setFrame({
          url: target.url,
          sandboxed: target.sandboxed === true,
          instrument: attempt.instrument,
          attemptId,
          locale: attempt.locale,
        });
      else if (target.kind === 'navigate') openTopLevel(target.url);
      else setFailure({ attemptId, key: 'providerLaunchError' });
    } catch (error) {
      setFailure({ attemptId, key: launchErrorKey(error) });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const framedAttemptId = frame?.attemptId ?? null;
  const closeFrame = useCallback(() => {
    if (framedAttemptId) setSettling({ attemptId: framedAttemptId, until: Date.now() + SETTLE_MAX_MS });
    setFrame(null);
    void refresh();
  }, [framedAttemptId, refresh]);

  // The player says the sitting ended: keep its receipt on screen (as timssuite.com shows it) and start re-reading.
  const finishFrame = useCallback(() => {
    if (framedAttemptId) setSettling({ attemptId: framedAttemptId, until: Date.now() + SETTLE_MAX_MS });
    setFrame((current) => (current ? { ...current, finished: true } : current));
    void refresh();
  }, [framedAttemptId, refresh]);

  // A framed PCA that finished (seen by polling) closes, as timssuite.com leaves its PCA page when the survey is done.
  const framedStatus = frame ? data?.find((a) => a.attemptId === frame.attemptId)?.status : undefined;
  useEffect(() => {
    if (frame?.sandboxed && framedStatus && FINISHED_STATUSES.has(framedStatus)) closeFrame();
  }, [frame?.sandboxed, framedStatus, closeFrame]);

  // Stop re-reading once the attempt has left "in progress", or after SETTLE_MAX_MS.
  const settlingStatus = settling ? data?.find((a) => a.attemptId === settling.attemptId)?.status : undefined;
  useEffect(() => {
    if (!settling) return;
    if (settlingStatus && FINISHED_STATUSES.has(settlingStatus)) {
      setSettling(null);
      return;
    }
    const timer = window.setTimeout(() => setSettling(null), Math.max(0, settling.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [settling, settlingStatus]);

  const header = (
    <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.portalDashboard.providerAssessments}</h2>
  );
  const section = (body: React.ReactNode) => (
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      {header}
      {body}
    </section>
  );

  // A test in progress stays mounted whatever happens to the list: a failed background refresh (the PCA poll, a window
  // refocus) must never unmount a running sitting, whose single-use launch link cannot be loaded again.
  const frameNode = frame && (
    <ProviderAssessmentFrame
      url={frame.url}
      sandboxed={frame.sandboxed}
      name={portalInstrumentName(frameMessages(frame.locale, t.portalDashboard), frame.instrument)}
      locale={frame.locale}
      playerOrigin={PLAYER_ORIGIN}
      finished={frame.finished === true}
      onClose={closeFrame}
      onFinished={finishFrame}
    />
  );
  const errorLine = <p className="text-[12px] text-[#B42318]">{t.portalDashboard.providerError}</p>;

  if (!data) {
    return section(
      <>
        {isLoading ? <p className="text-[12px] text-muted">{t.portalDashboard.providerLoading}</p> : isError ? errorLine : null}
        {frameNode}
      </>,
    );
  }

  // The same order everywhere the TIMS tests appear (HR's results board, the vacancy setup): LIA, English, Personality, PCA.
  const attempts = [...(data ?? [])].sort(
    (a, b) => (INSTRUMENT_ORDER[a.instrument] ?? 99) - (INSTRUMENT_ORDER[b.instrument] ?? 99),
  );
  const dateFormat = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return section(
    <>
      {isError && <div className="mb-3">{errorLine}</div>}
      {attempts.length === 0 ? (
        <p className="text-[12px] text-muted">{t.portalDashboard.providerEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {attempts.map((attempt) => (
            <ProviderAssessmentItem
              key={attempt.attemptId}
              attempt={attempt}
              t={t.portalDashboard}
              deadline={attempt.expiresAt ? dateFormat.format(new Date(attempt.expiresAt)) : null}
              busy={busy === attempt.attemptId}
              failureKey={failure?.attemptId === attempt.attemptId ? failure.key : null}
              consentOpen={consentFor === attempt.attemptId}
              notice={{ orgName, vacancyTitle: vacancyTitles.get(attempt.vacancyId) ?? '' }}
              onOpenConsent={() => setConsentFor(attempt.attemptId)}
              onCancelConsent={() => setConsentFor(null)}
              onStart={(decision) => void start(attempt, decision)}
            />
          ))}
        </ul>
      )}
      {frameNode}
    </>,
  );
}
