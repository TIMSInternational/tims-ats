'use client';

import type { useI18n } from '../../../../../lib/i18n';
import type {
  ConsentDecision,
  PortalProviderAttempt,
  PortalStatus,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { Button, StatusBadge, type StatusTone } from '../../../../../components';
import { ProviderAssessmentConsent } from './provider-assessment-consent';
import { ProviderAssessmentNoticeStep } from './provider-assessment-notice-step';

// One provider assessment in the candidate portal: its name, one coarse status with a hint, the start deadline while it
// has not started, and the one action its status allows (read the consent, start, continue). Completed, expired and
// needs-review entries have no action: the hint tells the candidate what happens next.
export type PortalMessages = ReturnType<typeof useI18n>['t']['portalDashboard'];

/** A launch with nothing newly accepted or declined (a sitting in progress resumes without the notice). */
const NO_DECISION: ConsentDecision = { accepted: [], declined: [] };

const STATUS_LABEL: Record<PortalStatus, keyof PortalMessages> = {
  consent_needed: 'providerStatusConsentNeeded',
  ready: 'providerStatusReady',
  in_progress: 'providerStatusInProgress',
  completed: 'providerStatusCompleted',
  expired: 'providerStatusExpired',
  needs_review: 'providerStatusNeedsReview',
};

const STATUS_HINT: Record<PortalStatus, keyof PortalMessages> = {
  consent_needed: 'providerHintConsentNeeded',
  ready: 'providerHintReady',
  in_progress: 'providerHintInProgress',
  completed: 'providerHintCompleted',
  expired: 'providerHintExpired',
  needs_review: 'providerHintNeedsReview',
};

const INSTRUMENT_LABEL: Record<string, keyof PortalMessages> = {
  lia: 'providerInstrumentLia',
  english: 'providerInstrumentEnglish',
  itcia: 'providerInstrumentItcia',
  personality: 'providerInstrumentPersonality',
  mi: 'providerInstrumentMi',
  pca: 'providerInstrumentPca',
};

/** The test's name as the candidate portal shows it. */
export function portalInstrumentName(t: PortalMessages, instrument: string): string {
  return t[INSTRUMENT_LABEL[instrument] ?? 'providerInstrumentOther'];
}

const INSTRUMENT_DESCRIPTION: Record<string, keyof PortalMessages> = {
  lia: 'providerDescriptionLia',
  english: 'providerDescriptionEnglish',
  personality: 'providerDescriptionPersonality',
  pca: 'providerDescriptionPca',
  itcia: 'providerDescriptionItcia',
  mi: 'providerDescriptionMi',
};

/** The short mark timssuite.com shows for each test, so a candidate who knows one recognises it here. */
const INSTRUMENT_MARK: Record<string, string> = {
  lia: 'LIA',
  english: 'EN',
  itcia: 'ITC',
  personality: 'P',
  mi: 'IM',
  pca: 'PCA',
};

/** One tone per meaning: done is green, waiting on the candidate is brand, under way or in review is amber. */
const STATUS_TONE: Record<PortalStatus, StatusTone> = {
  consent_needed: 'brand',
  ready: 'brand',
  in_progress: 'warning',
  completed: 'success',
  expired: 'neutral',
  needs_review: 'warning',
};

const FINISHED = new Set<PortalStatus>(['completed', 'expired', 'needs_review']);

export function ProviderAssessmentItem({
  attempt,
  t,
  deadline,
  busy,
  failureKey,
  consentOpen,
  notice,
  primary = true,
  justClosed = false,
  onOpenConsent,
  onCancelConsent,
  onStart,
}: {
  attempt: PortalProviderAttempt;
  /** The organization's name and this attempt's vacancy title, for the consent notice. */
  notice: { orgName: string; vacancyTitle: string };
  t: PortalMessages;
  deadline: string | null;
  busy: boolean;
  failureKey: keyof PortalMessages | null;
  consentOpen: boolean;
  /** Only the next test to take gets the filled button; the rest are secondary (buttons.md › Style). */
  primary?: boolean;
  /** The candidate just closed this test's provider page (PCA): its result may still be on its way. */
  justClosed?: boolean;
  onOpenConsent: () => void;
  onCancelConsent: () => void;
  onStart: (decision: ConsentDecision) => void;
}) {
  const name = portalInstrumentName(t, attempt.instrument);
  // A sitting not started yet first shows the organization's notice (Codex atsux run 1): through the consent step when
  // the provider still needs a consent, otherwise through the notice step. Only a started sitting resumes directly.
  const launchable = attempt.status === 'in_progress';
  const notStarted = attempt.status === 'ready' || attempt.status === 'consent_needed';
  const finished = FINISHED.has(attempt.status);
  // Closing the provider page does not prove the survey was finished: say the result may be on its way, never that
  // it was submitted, and offer to open it again without urging a second sitting.
  const awaiting = justClosed && attempt.status === 'ready';
  const variant = primary && !awaiting ? 'primary' : 'secondary';
  const action = (label: string, onClick: () => void, disabled = false) => (
    <Button variant={variant} size="lg" className="mt-3 w-full sm:w-auto" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
  return (
    <li className={`rounded-xl border border-border ${finished ? 'px-4 py-3' : 'p-4'}`} data-status={attempt.status}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex shrink-0 items-center justify-center rounded-xl bg-brand-tint font-semibold text-brand ${
            finished ? 'size-8 text-caption' : 'size-10 text-callout'
          }`}
        >
          {INSTRUMENT_MARK[attempt.instrument] ?? '·'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-subheading font-semibold text-brand">{name}</p>
          {!finished && (
            <p className="mt-0.5 text-callout text-secondary">
              {t[INSTRUMENT_DESCRIPTION[attempt.instrument] ?? 'providerDescriptionOther']}
            </p>
          )}
          {deadline && notStarted && (
            <p className="mt-1 text-caption text-secondary">
              {t.providerAvailableUntil} {deadline}
            </p>
          )}
        </div>
        <StatusBadge tone={awaiting ? 'neutral' : STATUS_TONE[attempt.status]} className="shrink-0">
          {awaiting ? t.providerStatusAwaitingResult : t[STATUS_LABEL[attempt.status]]}
        </StatusBadge>
      </div>
      <p className={`text-callout text-secondary ${finished ? 'mt-1 pl-11' : 'mt-2'}`}>
        {awaiting ? t.providerHintPcaPending : t[STATUS_HINT[attempt.status]]}
      </p>

      {attempt.status === 'consent_needed' &&
        (consentOpen ? (
          <ProviderAssessmentConsent
            attemptId={attempt.attemptId}
            busy={busy}
            notice={{ ...notice, instrumentName: name }}
            onAccept={onStart}
            onCancel={onCancelConsent}
          />
        ) : (
          action(t.providerReviewConsent, onOpenConsent)
        ))}

      {attempt.status === 'ready' &&
        (consentOpen ? (
          <ProviderAssessmentNoticeStep
            notice={{ ...notice, instrumentName: name }}
            busy={busy}
            onStart={(acknowledged) => onStart({ ...NO_DECISION, notice: acknowledged })}
            onCancel={onCancelConsent}
          />
        ) : (
          action(awaiting ? t.providerOpenAgain : t.providerStart, onOpenConsent)
        ))}

      {launchable && action(busy ? t.providerOpening : t.providerContinue, () => onStart(NO_DECISION), busy)}

      {failureKey && (
        <p role="alert" className="mt-2 text-callout text-danger">
          {t[failureKey]}
        </p>
      )}
    </li>
  );
}
