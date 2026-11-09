'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../../lib/i18n';
import { PlatformApiError } from '../../../../../lib/platform-api/client';
import {
  launchProviderAttempt,
  providerAttemptsKey,
  useMyProviderAssessments,
  type AcceptedConsent,
  type PortalProviderAttempt,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { canEmbedPlayer, chooseLaunchTarget, openTopLevel } from '../../../../../lib/assessment-player-launch';
import { ProviderAssessmentFrame } from './provider-assessment-frame';
import { ProviderAssessmentItem, type PortalMessages } from './provider-assessment-item';

// "Online assessments": the candidate's assessments run by the TIMS Assessments provider (AS-5, D16), next to the
// native quizzes of DashboardAssessments. Read from the C# portal routes, dark unless
// NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP is on. Each entry shows one coarse status (D9: never a review or validity
// state) and, when launchable, opens the launch's hosted URL: framed only when the player's registered frame ancestors
// include this site and its origin is the configured player origin; otherwise a top-level link-out. The URL carries a
// single-use launch code: it is opened at once and never stored, logged or shown.
const PLAYER_ORIGIN = process.env.NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN;

/** The message for a failed launch, from the route's stable code (or its status). */
export function launchErrorKey(error: unknown): keyof PortalMessages {
  if (error instanceof PlatformApiError) {
    if (error.code === 'consent_withdrawn') return 'providerLaunchWithdrawn';
    if (error.code === 'attempt_expired' || error.status === 410) return 'providerLaunchExpired';
    if (error.code === 'consent_required') return 'providerLaunchConsentRequired';
  }
  return 'providerLaunchError';
}

export function DashboardProviderAssessments({ orgSlug }: { orgSlug: string }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useMyProviderAssessments(orgSlug);
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ attemptId: string; key: keyof PortalMessages } | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: providerAttemptsKey(orgSlug) }),
    [queryClient, orgSlug],
  );

  const start = async (attempt: PortalProviderAttempt, consents: AcceptedConsent[]) => {
    const { attemptId } = attempt;
    setBusy(attemptId);
    setFailure(null);
    try {
      // Ask for an embedded launch (no return URL) only when the player could be framed at all: a native instrument and
      // a configured player origin. Whether THIS origin is a registered frame ancestor is known only from the launch.
      const embedded = attempt.delivery === 'native' && canEmbedPlayer(PLAYER_ORIGIN);
      let launch = await launchProviderAttempt(attemptId, consents, embedded);
      let target = chooseLaunchTarget(launch, window.location.origin, PLAYER_ORIGIN);
      if (embedded && target.kind === 'navigate') {
        // It cannot be framed after all: launch again for a top-level sitting, so the player returns the candidate to
        // this dashboard. A new launch revokes the first, unused launch code; consents were recorded by the first.
        launch = await launchProviderAttempt(attemptId, [], false);
        target = chooseLaunchTarget(launch, window.location.origin, PLAYER_ORIGIN);
        if (target.kind === 'iframe') target = { kind: 'navigate', url: target.url };
      }
      setConsentFor(null);
      if (target.kind === 'iframe') setFrameUrl(target.url);
      else if (target.kind === 'navigate') openTopLevel(target.url);
      else setFailure({ attemptId, key: 'providerLaunchError' });
    } catch (error) {
      setFailure({ attemptId, key: launchErrorKey(error) });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.portalDashboard.providerAssessments}</h2>
  );
  const section = (body: React.ReactNode) => (
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      {header}
      {body}
    </section>
  );

  if (isLoading) return section(<p className="text-[12px] text-muted">{t.portalDashboard.providerLoading}</p>);
  if (isError) return section(<p className="text-[12px] text-[#B42318]">{t.portalDashboard.providerError}</p>);

  const attempts = data ?? [];
  const dateFormat = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return section(
    <>
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
              onOpenConsent={() => setConsentFor(attempt.attemptId)}
              onCancelConsent={() => setConsentFor(null)}
              onStart={(consents) => void start(attempt, consents)}
            />
          ))}
        </ul>
      )}
      {frameUrl && (
        <ProviderAssessmentFrame
          url={frameUrl}
          onClose={() => {
            setFrameUrl(null);
            void refresh();
          }}
        />
      )}
    </>,
  );
}
