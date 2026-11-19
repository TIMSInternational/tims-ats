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
import { assessmentProviderFrameOrigin } from '../../../../../lib/security/csp';
import { DASHBOARD_CARD, DASHBOARD_EMPTY, DASHBOARD_ITEM, DASHBOARD_LIST, DASHBOARD_TITLE } from './dashboard-styles';
import { EvalLoadError } from './eval-load-error';
import { EVAL_SKELETON_CLASSES } from './eval-styles';
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
// PCA is answered on the provider's own site (timshr.com): framed (sandboxed) on this page by default, as timssuite.com
// frames it, in the same frame and bar as the other tests. The env overrides the origin or turns framing off, read
// through the resolver the CSP frame-src uses; a page on any other origin links out top-level.
const PROVIDER_FRAME_ORIGIN = assessmentProviderFrameOrigin(process.env.NEXT_PUBLIC_ASSESSMENT_PROVIDER_FRAME_ORIGIN);
/** timssuite.com checks its PCA page's survey every 15 s. */
export const PCA_POLL_MS = 15_000;
/** After a sitting ends, re-read every 2 s for at most 60 s until its result has arrived. */
export const SETTLE_POLL_MS = 2_000;
const SETTLE_MAX_MS = 60_000;
// The order HR reads them in (the results board): LIA, English, Personality, PCA, ITC-IA, MI.
const INSTRUMENT_ORDER: Record<string, number> = { lia: 0, english: 1, personality: 2, pca: 3, itcia: 4, mi: 5 };
const ACTIONABLE = new Set<PortalStatus>(['consent_needed', 'ready', 'in_progress']);
const FINISHED_STATUSES = new Set<PortalStatus>(['completed', 'needs_review', 'expired']);

// The loading placeholder in the TIMS evaluation design: soft PCA blocks in the shape of a test's panel (the code tile,
// the name and the description, the status chip).
const SKELETON_PANEL_CLASSES = `${DASHBOARD_ITEM} flex items-start gap-3`;
const SKELETON_TILE_CLASSES = `${EVAL_SKELETON_CLASSES} size-10 shrink-0`;
const SKELETON_TEXT_CLASSES = 'flex-1 space-y-2 pt-0.5';
const SKELETON_TITLE_CLASSES = `${EVAL_SKELETON_CLASSES} h-[18px] w-1/3`;
const SKELETON_LINE_CLASSES = `${EVAL_SKELETON_CLASSES} h-3 w-2/3`;
const SKELETON_CHIP_CLASSES = 'h-7 w-24 shrink-0 animate-pulse rounded-full bg-eval-bg3 motion-reduce:animate-none';
/** The list-refresh error over a list that is still shown. */
const INLINE_ERROR_CLASSES = 'mb-3';

/** The message for a failed launch, from the route's stable code (or its status). */
export function launchErrorKey(error: unknown): keyof PortalMessages {
  if (error instanceof PlatformApiError) {
    if (error.code === 'consent_withdrawn') return 'providerLaunchWithdrawn';
    if (error.code === 'attempt_expired' || error.status === 410) return 'providerLaunchExpired';
    if (error.code === 'consent_required') return 'providerLaunchConsentRequired';
  }
  return 'providerLaunchError';
}

// `hideWhenEmpty`: the pilot launch scope keeps this section only for a candidate who actually has TIMS tests (their
// organization was bound by a platform owner and HR assigned one); everyone else sees no assessments block at all.
export function DashboardProviderAssessments({
  orgSlug,
  orgName,
  hideWhenEmpty = false,
}: {
  orgSlug: string;
  orgName: string;
  hideWhenEmpty?: boolean;
}) {
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
  const { data, isLoading, isError, refetch } = useMyProviderAssessments(orgSlug, {
    pollMs: settling ? SETTLE_POLL_MS : frame?.sandboxed ? PCA_POLL_MS : false,
  });
  // The same (cached) read as "My applications": the consent notice names the vacancy of each assessment.
  const applications = trpc.candidatePortal.myApplications.useQuery({ orgSlug });
  const vacancyTitles = new Map((applications.data ?? []).map((a) => [a.vacancy.id, a.vacancy.title]));
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ attemptId: string; key: keyof PortalMessages } | null>(null);
  // Provider pages (PCA) the candidate closed in this session: until the result arrives the card says it may be on its
  // way instead of inviting a second sitting. UI state only: no data or polling change.
  const [closedPages, setClosedPages] = useState<ReadonlySet<string>>(() => new Set());

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
  const framedSandboxed = frame?.sandboxed === true;
  const closeFrame = useCallback(() => {
    if (framedAttemptId) setSettling({ attemptId: framedAttemptId, until: Date.now() + SETTLE_MAX_MS });
    if (framedAttemptId && framedSandboxed) setClosedPages((current) => new Set(current).add(framedAttemptId));
    setFrame(null);
    void refresh();
  }, [framedAttemptId, framedSandboxed, refresh]);

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

  // A block under the PCA divider with its serif title (no card of its own: the sheet is the one white surface).
  const section = (body: React.ReactNode) => (
    <section aria-labelledby="provider-assessments-heading" className={DASHBOARD_CARD}>
      <h2 id="provider-assessments-heading" className={DASHBOARD_TITLE}>
        {t.portalDashboard.providerAssessments}
      </h2>
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
  const retry = () => void refetch();

  if (!data) {
    if (hideWhenEmpty && !frameNode) return null;
    return section(
      <>
        {isLoading ? (
          <div aria-busy="true" className={DASHBOARD_LIST}>
            <span className="sr-only">{t.portalDashboard.providerLoading}</span>
            {[0, 1].map((row) => (
              <div key={row} aria-hidden="true" className={SKELETON_PANEL_CLASSES}>
                <div className={SKELETON_TILE_CLASSES} />
                <div className={SKELETON_TEXT_CLASSES}>
                  <div className={SKELETON_TITLE_CLASSES} />
                  <div className={SKELETON_LINE_CLASSES} />
                </div>
                <div className={SKELETON_CHIP_CLASSES} />
              </div>
            ))}
          </div>
        ) : isError ? (
          <EvalLoadError title={t.portalDashboard.providerError} onRetry={retry} />
        ) : null}
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

  // The next test to take (first actionable in this order) is the one filled button on the list.
  const isAwaiting = (a: PortalProviderAttempt) => closedPages.has(a.attemptId) && a.status === 'ready';
  const nextId = attempts.find((a) => ACTIONABLE.has(a.status) && !isAwaiting(a))?.attemptId ?? null;
  if (hideWhenEmpty && attempts.length === 0 && !frameNode) return null;

  return section(
    <>
      {isError && (
        <EvalLoadError className={INLINE_ERROR_CLASSES} title={t.portalDashboard.providerError} onRetry={retry} />
      )}
      {attempts.length === 0 ? (
        <p className={DASHBOARD_EMPTY}>{t.portalDashboard.providerEmpty}</p>
      ) : (
        <ul className={DASHBOARD_LIST}>
          {attempts.map((attempt) => (
            <ProviderAssessmentItem
              key={attempt.attemptId}
              attempt={attempt}
              t={t.portalDashboard}
              deadline={attempt.expiresAt ? dateFormat.format(new Date(attempt.expiresAt)) : null}
              busy={busy === attempt.attemptId}
              failureKey={failure?.attemptId === attempt.attemptId ? failure.key : null}
              consentOpen={consentFor === attempt.attemptId}
              primary={attempt.attemptId === nextId}
              justClosed={closedPages.has(attempt.attemptId)}
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
