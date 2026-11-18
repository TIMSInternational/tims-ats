'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { Button, ErrorState, Skeleton, StatusBadge, type StatusTone } from '../../../../../components';
import {
  classifyConsentError,
  isCandidateConsentEnabled,
  useCandidateConsent,
} from '../../../../../lib/platform-api/candidate-consent';
import { ConsentWithdrawModal } from './consent-withdraw-modal';
import { consentChannelLabel, deletionStatusLabel } from './consent-labels';

const STATUS_TONE: Record<string, StatusTone> = { granted: 'success', withdrawn: 'danger', none: 'neutral' };

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
    const kind = classifyConsentError(consent.error);
    // 403 = no org-wide access; 'unavailable' = the C# route is not mapped (web flag on, C# flag off).
    if (kind === 'forbidden' || kind === 'unavailable') return null;
    return <ErrorState message={m.loadError} onRetry={() => void consent.refetch()} error={consent.error} />;
  }
  const view = consent.data;
  if (!view) return null;

  const { consent: status, evidence, deletionRequest } = view;
  const statusLabel =
    status.status === 'granted' ? m.statusGranted : status.status === 'withdrawn' ? m.statusWithdrawn : m.statusNone;

  return (
    <div className="rounded-xl bg-white p-4 shadow-card md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-subheading font-semibold text-brand">{m.title}</h3>
        <StatusBadge tone={STATUS_TONE[status.status] ?? 'neutral'}>{statusLabel}</StatusBadge>
      </div>

      <dl className="space-y-1.5 text-callout">
        {status.textVersion && status.agreedAt && (
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">{m.agreedAt}</dt>
            <dd className="text-primary">
              {formatDate(status.agreedAt)} · {m.textVersion} {status.textVersion}
            </dd>
          </div>
        )}
        {status.withdrawnAt && (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">{m.withdrawnAt}</dt>
              <dd className="text-primary">{formatDate(status.withdrawnAt)}</dd>
            </div>
            <p className="text-secondary">
              {status.withdrawnBy === 'candidate' ? m.withdrawnByCandidate : m.withdrawnByStaff}
              {status.withdrawalChannel ? ` · ${consentChannelLabel(status.withdrawalChannel, m)}` : ''}
            </p>
            {status.withdrawalReason && (
              <p className="whitespace-pre-wrap text-secondary">
                {m.reasonLabel}: {status.withdrawalReason}
              </p>
            )}
          </>
        )}
        {deletionRequest && (
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">{m.deletionRequest}</dt>
            <dd className="font-medium text-primary">
              {deletionStatusLabel(deletionRequest.status, m)} · {formatDate(deletionRequest.createdAt)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-2 text-caption font-medium text-secondary">{m.evidenceTitle}</p>
        {evidence.length === 0 ? (
          <p className="text-callout text-secondary">{m.evidenceEmpty}</p>
        ) : (
          <ul className="space-y-1.5">
            {evidence.map((item) => (
              <li key={item.applicationId} className="rounded-lg bg-surface px-3 py-2 text-callout text-primary">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span>{formatDate(item.agreedAt)}</span>
                  <span className="text-secondary">
                    {m.textVersion} {item.textVersion}
                    {item.locale ? ` (${item.locale})` : ''}
                  </span>
                  {item.isBackfilled && (
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge tone="warning" icon="none">
                        {m.evidenceBackfilled}
                      </StatusBadge>
                      <span className="sr-only">{m.evidenceBackfilledHint}</span>
                    </span>
                  )}
                </div>
                {(item.hasRequestMetadata || item.captchaVerified) && (
                  <p className="mt-0.5 text-caption text-secondary">
                    {[
                      item.hasRequestMetadata ? m.evidenceMetadata : null,
                      item.captchaVerified ? m.evidenceCaptcha : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {status.status === 'withdrawn' && <p className="mt-3 text-caption text-secondary">{m.reopenHint}</p>}
      {status.status !== 'withdrawn' && (
        <Button variant="destructive-secondary" size="sm" className="mt-4" onClick={() => setWithdrawing(true)}>
          {m.recordWithdrawal}
        </Button>
      )}
      {withdrawing && <ConsentWithdrawModal candidateId={candidateId} onClose={() => setWithdrawing(false)} />}
    </div>
  );
}
