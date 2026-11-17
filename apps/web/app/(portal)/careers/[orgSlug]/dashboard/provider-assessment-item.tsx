'use client';

import type { ReactNode } from 'react';
import { CalendarClock, Check, CircleAlert, Clock, Hourglass, Play } from 'lucide-react';
import type { useI18n } from '../../../../../lib/i18n';
import type {
  ConsentDecision,
  PortalProviderAttempt,
  PortalStatus,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { DASHBOARD_ITEM, DASHBOARD_ITEM_HEAD, DASHBOARD_ITEM_TITLE } from './dashboard-styles';
import { EvalButton } from './eval-button';
import { EvalCallout } from './eval-callout';
import { EvalChip } from './eval-chip';
import { EvalCodeTile } from './eval-code-tile';
import type { EvalChipTone } from './eval-control-styles';
import { EVAL_CAPTION_CLASSES, EVAL_HINT_CLASSES, EVAL_LEAD_CLASSES } from './eval-styles';
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

/** One tone per meaning (PCA Chip): waiting on the candidate is warn, done is ok, expired is danger, in the team's
 * hands is neutral. Always a word with its icon, never a colour alone. */
const STATUS_TONE: Record<PortalStatus, EvalChipTone> = {
  consent_needed: 'warn',
  ready: 'warn',
  in_progress: 'warn',
  completed: 'ok',
  expired: 'danger',
  needs_review: 'neutral',
};
const STATUS_ICON: Record<PortalStatus, ReactNode> = {
  consent_needed: <CircleAlert aria-hidden="true" />,
  ready: <Play aria-hidden="true" />,
  in_progress: <Hourglass aria-hidden="true" />,
  completed: <Check aria-hidden="true" strokeWidth={2.5} />,
  expired: <Clock aria-hidden="true" />,
  needs_review: <Hourglass aria-hidden="true" />,
};
/** The candidate closed the provider's page (PCA): the result may be on its way, in nobody's hands but the provider's. */
const AWAITING_ICON = <Hourglass aria-hidden="true" />;

const FINISHED = new Set<PortalStatus>(['completed', 'expired', 'needs_review']);

// The panel in the TIMS evaluation design: a PCA bordered panel; a finished test is a quieter, tighter one (less
// padding, no description, its hint under the name). The code tile is the same 40px tile in every status.
type Shape = 'open' | 'finished';
const ITEM_CLASSES: Record<Shape, string> = {
  open: DASHBOARD_ITEM,
  finished:
    'rounded-eval-card border border-eval-line bg-white px-4 py-3 text-eval-ink shadow-eval-card md:px-5 md:py-3.5',
};
/** The code tile beside the name, chip, and lines. */
const HEAD_CLASSES = 'flex items-start gap-3';
const TEXT_CLASSES = 'min-w-0 flex-1';
/** The instrument's description (13px ink2). */
const DESCRIPTION_CLASSES = `${EVAL_HINT_CLASSES} mt-1`;
/** "Available until …" with a small calendar icon, as the PCA landing writes its "saves itself" line. */
const DEADLINE_CLASSES = `${EVAL_CAPTION_CLASSES} mt-1.5 flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0`;
/** What to do now: r-lead under the head of a test still to take; a hint under the name of a finished one. */
const STATUS_HINT_CLASSES: Record<Shape, string> = {
  open: `${EVAL_LEAD_CLASSES} mt-3`,
  finished: `${EVAL_HINT_CLASSES} mt-1`,
};
const ACTION_CLASSES = 'mt-4';
const FAILURE_CLASSES = 'mt-3';

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
  const shape: Shape = finished ? 'finished' : 'open';
  const action = (label: string, onClick: () => void, loading = false, loadingLabel?: string) => (
    <EvalButton
      variant={variant}
      width="bar"
      className={ACTION_CLASSES}
      loading={loading}
      loadingLabel={loadingLabel}
      onClick={onClick}
    >
      {label}
    </EvalButton>
  );
  const hint = (
    <p className={STATUS_HINT_CLASSES[shape]}>{awaiting ? t.providerHintPcaPending : t[STATUS_HINT[attempt.status]]}</p>
  );
  return (
    <li className={ITEM_CLASSES[shape]} data-status={attempt.status}>
      <div className={HEAD_CLASSES}>
        <EvalCodeTile code={INSTRUMENT_MARK[attempt.instrument] ?? '·'} />
        <div className={TEXT_CLASSES}>
          <div className={DASHBOARD_ITEM_HEAD}>
            <div className={TEXT_CLASSES}>
              <p className={DASHBOARD_ITEM_TITLE}>{name}</p>
              {!finished && (
                <p className={DESCRIPTION_CLASSES}>
                  {t[INSTRUMENT_DESCRIPTION[attempt.instrument] ?? 'providerDescriptionOther']}
                </p>
              )}
              {deadline && notStarted && (
                <p className={DEADLINE_CLASSES}>
                  <CalendarClock aria-hidden="true" />
                  <span>
                    {t.providerAvailableUntil} {deadline}
                  </span>
                </p>
              )}
            </div>
            <EvalChip
              tone={awaiting ? 'neutral' : STATUS_TONE[attempt.status]}
              icon={awaiting ? AWAITING_ICON : STATUS_ICON[attempt.status]}
            >
              {awaiting ? t.providerStatusAwaitingResult : t[STATUS_LABEL[attempt.status]]}
            </EvalChip>
          </div>
          {finished && hint}
        </div>
      </div>
      {!finished && hint}

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

      {launchable && action(t.providerContinue, () => onStart(NO_DECISION), busy, t.providerOpening)}

      {failureKey && (
        <EvalCallout tone="err" role="alert" className={FAILURE_CLASSES}>
          {t[failureKey]}
        </EvalCallout>
      )}
    </li>
  );
}
