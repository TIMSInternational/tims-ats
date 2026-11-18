'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { Modal } from '../../../../../components';
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
    <section aria-labelledby="portal-privacy-title" className="rounded-2xl border border-[#EDEDED] bg-white p-6">
      <h2 id="portal-privacy-title" className="mb-2 text-[15px] font-semibold text-[#1F114C]">
        {pd.privacyTitle}
      </h2>
      {!consentEnabled ? null : phase === 'done' || withdrawnAt ? (
        <div role="status">
          <p className="text-[13px] font-semibold text-[#333]">{m.doneTitle}</p>
          {withdrawnAt && phase !== 'done' && (
            <p className="mt-1 text-[13px] text-[#585858]">{m.withdrawnOn.replace('{date}', formatDate(withdrawnAt))}</p>
          )}
          <p className="mt-1 text-[13px] text-[#585858]">{m.doneBody}</p>
        </div>
      ) : (
        <>
          <p className="text-[13px] text-[#585858]">{m.desc.replace('{org}', orgName)}</p>
          <button
            type="button"
            onClick={() => setPhase('confirming')}
            className="mt-4 h-10 rounded-xl border border-[#DD0C15] px-5 text-[13px] font-semibold text-[#DD0C15] transition hover:bg-red-50"
          >
            {m.revokeButton}
          </button>
        </>
      )}

      <p className={`text-[13px] text-[#585858]${consentEnabled ? ' mt-4' : ''}`}>
        {contactEmail ? (
          <>
            {requestsBefore}
            <a href={`mailto:${contactEmail}`} className="font-medium text-[#1F114C] underline">
              {contactEmail}
            </a>
            {requestsAfter}
          </>
        ) : (
          pd.privacyRequestsNoContact.replace('{org}', orgName)
        )}
      </p>
      <Link
        href={`/careers/${orgSlug}/privacy`}
        className="mt-2 inline-block text-[12px] font-medium text-[#1F114C] hover:underline"
      >
        {pd.privacyNoticeLink}
      </Link>

      {consentEnabled && (phase === 'confirming' || phase === 'submitting') && (
        <Modal title={m.confirmTitle} onClose={() => phase !== 'submitting' && setPhase('idle')}>
          <p className="text-[13px] text-[#585858]">{m.confirmBody.replace('{org}', orgName)}</p>
          {error && (
            <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={phase === 'submitting'}
              onClick={() => setPhase('idle')}
              className="h-10 rounded-xl border border-[#EDEDED] px-4 text-[13px] text-[#585858] hover:bg-[#F6F6F6] disabled:opacity-50"
            >
              {m.cancel}
            </button>
            <button
              type="button"
              disabled={phase === 'submitting'}
              onClick={() => void revoke()}
              className="h-10 rounded-xl bg-[#DD0C15] px-5 text-[13px] font-semibold text-white hover:bg-[#b80a12] disabled:opacity-50"
            >
              {phase === 'submitting' ? m.submitting : m.confirmButton}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
