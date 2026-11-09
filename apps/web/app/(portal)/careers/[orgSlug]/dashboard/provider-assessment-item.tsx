'use client';

import type { useI18n } from '../../../../../lib/i18n';
import type {
  ConsentDecision,
  PortalProviderAttempt,
  PortalStatus,
} from '../../../../../lib/platform-api/assessment-provider-portal';
import { ProviderAssessmentConsent } from './provider-assessment-consent';
import { ProviderAssessmentNoticeStep } from './provider-assessment-notice-step';

// One provider assessment in the candidate portal: its name, one coarse status with a hint, the start deadline while it
// has not started, and the one action its status allows (read the consent, start, continue). Completed, expired and
// needs-review entries have no action: the hint tells the candidate what happens next.
export type PortalMessages = ReturnType<typeof useI18n>['t']['portalDashboard'];

/** A launch with nothing newly accepted or declined (no consent step shown). */
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

const BUTTON =
  'mt-3 inline-flex h-9 items-center rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] transition disabled:opacity-50';

export function ProviderAssessmentItem({
  attempt,
  t,
  deadline,
  busy,
  failureKey,
  consentOpen,
  notice,
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
  onOpenConsent: () => void;
  onCancelConsent: () => void;
  onStart: (decision: ConsentDecision) => void;
}) {
  const name = t[INSTRUMENT_LABEL[attempt.instrument] ?? 'providerInstrumentOther'];
  // A sitting not started yet first shows the organization's notice (Codex atsux run 1): through the consent step when
  // the provider still needs a consent, otherwise through the notice step. Only a started sitting resumes directly.
  const launchable = attempt.status === 'in_progress';
  const notStarted = attempt.status === 'ready' || attempt.status === 'consent_needed';
  return (
    <li className="rounded-xl border border-[#EDEDED] p-4" data-status={attempt.status}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#1F114C] truncate">{name}</p>
          {deadline && notStarted && (
            <p className="text-[11px] text-muted mt-1">
              {t.providerAvailableUntil} {deadline}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-[#F4F1FF] px-2.5 py-1 text-[11px] font-medium text-[#1F114C]">
          {t[STATUS_LABEL[attempt.status]]}
        </span>
      </div>
      <p className="text-[12px] text-[#585858] mt-2">{t[STATUS_HINT[attempt.status]]}</p>

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
          <button type="button" onClick={onOpenConsent} className={BUTTON}>
            {t.providerReviewConsent}
          </button>
        ))}

      {attempt.status === 'ready' &&
        (consentOpen ? (
          <ProviderAssessmentNoticeStep
            notice={{ ...notice, instrumentName: name }}
            busy={busy}
            onStart={() => onStart(NO_DECISION)}
            onCancel={onCancelConsent}
          />
        ) : (
          <button type="button" onClick={onOpenConsent} className={BUTTON}>
            {t.providerStart}
          </button>
        ))}

      {launchable && (
        <button type="button" disabled={busy} onClick={() => onStart(NO_DECISION)} className={BUTTON}>
          {busy ? t.providerOpening : t.providerContinue}
        </button>
      )}

      {failureKey && (
        <p role="alert" className="text-[12px] text-[#B42318] mt-2">
          {t[failureKey]}
        </p>
      )}
    </li>
  );
}
