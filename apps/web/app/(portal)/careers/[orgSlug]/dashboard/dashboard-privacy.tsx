'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, ShieldOff } from 'lucide-react';
import { useI18n } from '../../../../../lib/i18n';
import { EvalAlertDialog } from './eval-alert-dialog';
import { EvalButton } from './eval-button';
import { EvalCallout } from './eval-callout';
import { EVAL_CALLOUT_TITLE_CLASSES } from './eval-control-styles';
import { EVAL_LEAD_CLASSES, EVAL_LINK_CLASSES, EVAL_STANDALONE_LINK_CLASSES } from './eval-styles';
import { DASHBOARD_CARD, DASHBOARD_HEADING } from './dashboard-styles';
import { formatDate } from '../../../../../lib/format-utils';
import {
  classifyConsentError,
  isCandidateConsentEnabled,
  withdrawMyConsent,
} from '../../../../../lib/platform-api/candidate-consent';

type Phase = 'idle' | 'confirming' | 'submitting' | 'done';

// The section in the TIMS evaluation design (PCA): r-lead text, the revoke action in the secondary shape with danger
// text at the bar height (the section's main action, in no panel), its confirmation as the PCA alert dialog (filled
// danger confirm), the done state as an ok callout, and the privacy notice as an accent link. The blocks are spaced by
// the column's gap (no conditional margins).
const PRIVACY_BODY_CLASSES = 'mt-2 flex flex-col gap-4';
/** Full width on phones (the PCA bar), its own width from md (the column stretches its children). */
const PRIVACY_REVOKE_CLASSES = 'md:self-start';
const PRIVACY_DONE_LINE_CLASSES = 'm-0 mt-1';
/** The requests line and the notice link read as one block. */
const PRIVACY_REQUESTS_CLASSES = 'flex flex-col gap-1';

// The candidate's privacy panel. Always shown (audit C-33): how to ask the organization for a copy, a correction or
// the deletion of their data — its candidate contact mailbox when it has one — and the privacy notice.
// #312 — plus the candidate's own "Revocar autorización" when the C# consent surface is enabled. The identity is the
// session's VERIFIED email (checked again by the server against the auth service); nothing here sends an email or a
// candidate id.
export function DashboardPrivacy({
  orgSlug,
  orgName,
  withdrawnAt = null,
  contactEmail = null,
}: {
  orgSlug: string;
  orgName: string;
  // Server-persisted withdrawal time (dashboard/page.tsx), so a revisit shows the revoked state.
  withdrawnAt?: string | null;
  // The organization's configured candidate contact (settings.candidateContactEmail only, never billingEmail); null = none set.
  contactEmail?: string | null;
}) {
  const { t } = useI18n();
  const m = t.portalConsentWithdrawal;
  const pd = t.portalDashboard;
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const consentEnabled = isCandidateConsentEnabled();
  const [requestsBefore, requestsAfter = ''] = pd.privacyRequests.split('{email}');

  const revoke = async () => {
    setPhase('submitting');
    setError('');
    try {
      await withdrawMyConsent(orgSlug);
      setPhase('done');
    } catch (err) {
      const kind = classifyConsentError(err);
      setError(
        kind === 'not_verified'
          ? m.errorNotVerified
          : kind === 'rate_limited'
            ? m.errorRateLimited
            : kind === 'unavailable'
              ? m.errorUnavailable
              : m.errorGeneric,
      );
      setPhase('confirming');
    }
  };

  return (
    <section aria-labelledby="portal-privacy-title" className={DASHBOARD_CARD}>
      <h2 id="portal-privacy-title" className={DASHBOARD_HEADING}>
        {pd.privacyTitle}
      </h2>
      <div className={PRIVACY_BODY_CLASSES}>
        {!consentEnabled ? null : phase === 'done' || withdrawnAt ? (
          <EvalCallout tone="ok" role="status" icon={<ShieldCheck aria-hidden="true" />}>
            <p className={EVAL_CALLOUT_TITLE_CLASSES}>{m.doneTitle}</p>
            {withdrawnAt && phase !== 'done' && (
              <p className={PRIVACY_DONE_LINE_CLASSES}>{m.withdrawnOn.replace('{date}', formatDate(withdrawnAt))}</p>
            )}
            <p className={PRIVACY_DONE_LINE_CLASSES}>{m.doneBody}</p>
          </EvalCallout>
        ) : (
          <>
            <p className={EVAL_LEAD_CLASSES}>{m.desc.replace('{org}', orgName)}</p>
            <EvalButton
              variant="secondary-danger"
              width="bar"
              icon={<ShieldOff aria-hidden="true" />}
              onClick={() => setPhase('confirming')}
              className={PRIVACY_REVOKE_CLASSES}
            >
              {m.revokeButton}
            </EvalButton>
          </>
        )}

        <div className={PRIVACY_REQUESTS_CLASSES}>
          <p className={EVAL_LEAD_CLASSES}>
            {contactEmail ? (
              <>
                {requestsBefore}
                <a href={`mailto:${contactEmail}`} className={EVAL_LINK_CLASSES}>
                  {contactEmail}
                </a>
                {requestsAfter}
              </>
            ) : (
              pd.privacyRequestsNoContact.replace('{org}', orgName)
            )}
          </p>
          <Link href={`/careers/${orgSlug}/privacy`} className={EVAL_STANDALONE_LINK_CLASSES}>
            {pd.privacyNoticeLink}
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>

      {consentEnabled && (phase === 'confirming' || phase === 'submitting') && (
        <EvalAlertDialog
          tone="danger"
          icon={<ShieldOff aria-hidden="true" />}
          title={m.confirmTitle}
          body={m.confirmBody.replace('{org}', orgName)}
          onClose={() => phase !== 'submitting' && setPhase('idle')}
          actions={
            <>
              <EvalButton variant="secondary" disabled={phase === 'submitting'} onClick={() => setPhase('idle')}>
                {m.cancel}
              </EvalButton>
              <EvalButton
                variant="danger"
                loading={phase === 'submitting'}
                loadingLabel={m.submitting}
                onClick={() => void revoke()}
              >
                {m.confirmButton}
              </EvalButton>
            </>
          }
        >
          {error && (
            <EvalCallout tone="err" role="alert">
              {error}
            </EvalCallout>
          )}
        </EvalAlertDialog>
      )}
    </section>
  );
}
