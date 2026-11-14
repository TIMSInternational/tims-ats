'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { Modal } from '../../../../../components';
import { Button } from '../../../../../components/button';
import { TEXT_LINK_CLASSES } from '../../../../../components/button-styles';
import { DASHBOARD_CARD, DASHBOARD_TITLE } from './dashboard-styles';
import { formatDate } from '../../../../../lib/format-utils';
import {
  classifyConsentError,
  isCandidateConsentEnabled,
  withdrawMyConsent,
} from '../../../../../lib/platform-api/candidate-consent';

type Phase = 'idle' | 'confirming' | 'submitting' | 'done';

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
      <h2 id="portal-privacy-title" className={DASHBOARD_TITLE}>
        {pd.privacyTitle}
      </h2>
      {!consentEnabled ? null : phase === 'done' || withdrawnAt ? (
        <div role="status">
          <p className="text-body font-semibold text-primary">{m.doneTitle}</p>
          {withdrawnAt && phase !== 'done' && (
            <p className="mt-1 text-base text-secondary sm:text-body">{m.withdrawnOn.replace('{date}', formatDate(withdrawnAt))}</p>
          )}
          <p className="mt-1 text-base text-secondary sm:text-body">{m.doneBody}</p>
        </div>
      ) : (
        <>
          <p className="text-base text-secondary sm:text-body">{m.desc.replace('{org}', orgName)}</p>
          <Button variant="destructive-secondary" onClick={() => setPhase('confirming')} className="mt-4">
            {m.revokeButton}
          </Button>
        </>
      )}

      <p className={`text-base text-secondary sm:text-body${consentEnabled ? ' mt-4' : ''}`}>
        {contactEmail ? (
          <>
            {requestsBefore}
            <a href={`mailto:${contactEmail}`} className="font-medium text-brand underline [overflow-wrap:anywhere]">
              {contactEmail}
            </a>
            {requestsAfter}
          </>
        ) : (
          pd.privacyRequestsNoContact.replace('{org}', orgName)
        )}
      </p>
      <Link href={`/careers/${orgSlug}/privacy`} className={`${TEXT_LINK_CLASSES} mt-2 min-h-7 text-callout`}>
        {pd.privacyNoticeLink}
      </Link>

      {consentEnabled && (phase === 'confirming' || phase === 'submitting') && (
        <Modal
          title={m.confirmTitle}
          size="sm"
          onClose={() => phase !== 'submitting' && setPhase('idle')}
          footer={
            <>
              <Button variant="secondary" disabled={phase === 'submitting'} onClick={() => setPhase('idle')}>
                {m.cancel}
              </Button>
              <Button
                variant="destructive"
                loading={phase === 'submitting'}
                loadingLabel={m.submitting}
                onClick={() => void revoke()}
              >
                {m.confirmButton}
              </Button>
            </>
          }
        >
          <p className="text-base text-secondary sm:text-body">{m.confirmBody.replace('{org}', orgName)}</p>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-bg p-3 text-callout text-danger">
              {error}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
