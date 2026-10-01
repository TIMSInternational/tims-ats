'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { ErrorState, Skeleton } from '../../../../../components';
import {
  classifyConsentError,
  isCandidateConsentEnabled,
  useCandidateConsent,
} from '../../../../../lib/platform-api/candidate-consent';
import { ConsentWithdrawModal } from './consent-withdraw-modal';
import { consentChannelLabel, deletionStatusLabel } from './consent-labels';

const STATUS_CLS: Record<string, string> = {
  granted: 'bg-green-50 text-green-700 border border-green-200',
  withdrawn: 'bg-red-50 text-red-700 border border-red-200',
  none: 'bg-[#F6F6F6] text-[#585858] border border-[#EDEDED]',
};

// #312/#313 — the candidate's data-processing authorization: status, proof per application, deletion request,
// and the staff action to record a withdrawal received outside the portal. Renders nothing while the C#
// surface is dark, and nothing for a caller without org-wide candidate access (403).
export function CandidateConsentCard({ candidateId }: { candidateId: string }) {
  const { t } = useI18n();
  const m = t.candidateConsent;
  const [withdrawing, setWithdrawing] = useState(false);
  const consent = useCandidateConsent(candidateId);

  if (!isCandidateConsentEnabled()) return null;
  if (consent.isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (consent.isError) {
    if (classifyConsentError(consent.error) === 'forbidden') return null;
    return <ErrorState message={m.loadError} onRetry={() => void consent.refetch()} />;
  }
  const view = consent.data;
  if (!view) return null;

  const { consent: status, evidence, deletionRequest } = view;
  const statusLabel =
    status.status === 'granted' ? m.statusGranted : status.status === 'withdrawn' ? m.statusWithdrawn : m.statusNone;

  return (
    <div className="rounded-xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{m.title}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[status.status]}`}>
          {statusLabel}
        </span>
      </div>

      <dl className="space-y-1.5 text-[12px]">
        {status.textVersion && status.agreedAt && (
          <div className="flex justify-between gap-3">
            <dt className="text-[#8B8B8B]">{m.agreedAt}</dt>
            <dd className="text-[#333]">
              {formatDate(status.agreedAt)} · {m.textVersion} {status.textVersion}
            </dd>
          </div>
        )}
        {status.withdrawnAt && (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-[#8B8B8B]">{m.withdrawnAt}</dt>
              <dd className="text-[#333]">{formatDate(status.withdrawnAt)}</dd>
            </div>
            <p className="text-[#585858]">
              {status.withdrawnBy === 'candidate' ? m.withdrawnByCandidate : m.withdrawnByStaff}
              {status.withdrawalChannel ? ` · ${consentChannelLabel(status.withdrawalChannel, m)}` : ''}
            </p>
            {status.withdrawalReason && (
              <p className="whitespace-pre-wrap text-[#585858]">
                {m.reasonLabel}: {status.withdrawalReason}
              </p>
            )}
          </>
        )}
        {deletionRequest && (
          <div className="flex justify-between gap-3">
            <dt className="text-[#8B8B8B]">{m.deletionRequest}</dt>
            <dd className="font-medium text-[#333]">
              {deletionStatusLabel(deletionRequest.status, m)} · {formatDate(deletionRequest.createdAt)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 border-t border-[#F6F6F6] pt-3">
        <p className="mb-2 text-[11px] text-[#8B8B8B]">{m.evidenceTitle}</p>
        {evidence.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{m.evidenceEmpty}</p>
        ) : (
          <ul className="space-y-1.5">
            {evidence.map((item) => (
              <li key={item.applicationId} className="rounded-lg bg-[#F6F6F6] px-3 py-2 text-[12px] text-[#333]">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span>{formatDate(item.agreedAt)}</span>
                  <span className="text-[#8B8B8B]">
                    {m.textVersion} {item.textVersion}
                    {item.locale ? ` (${item.locale})` : ''}
                  </span>
                  {item.isBackfilled && (
                    <span title={m.evidenceBackfilledHint} className="rounded bg-amber-50 px-1.5 text-[10px] text-amber-700">
                      {m.evidenceBackfilled}
                    </span>
                  )}
                </div>
                {(item.hasRequestMetadata || item.captchaVerified) && (
                  <p className="mt-0.5 text-[11px] text-[#8B8B8B]">
                    {[item.hasRequestMetadata ? m.evidenceMetadata : null, item.captchaVerified ? m.evidenceCaptcha : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {status.status !== 'withdrawn' && (
        <button
          type="button"
          onClick={() => setWithdrawing(true)}
          className="mt-4 text-[12px] font-medium text-[#DD0C15] hover:underline"
        >
          {m.recordWithdrawal}
        </button>
      )}
      {withdrawing && <ConsentWithdrawModal candidateId={candidateId} onClose={() => setWithdrawing(false)} />}
    </div>
  );
}
