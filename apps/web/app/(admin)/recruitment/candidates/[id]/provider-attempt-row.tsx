'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatMessage } from '../../../../../lib/i18n/format';
import { Button } from '../../../../../components';
import type { StaffProviderAttempt } from '../../../../../lib/platform-api/assessment-providers-staff';
import { ProviderStatusChip } from './provider-status-chip';
import { ProviderResultDetail } from './provider-result-detail';
import { ProviderProctoringNote } from './provider-proctoring-note';

const CANCELLABLE = new Set(['pending', 'consent_needed', 'sent', 'in_progress']);
// The required "assessment" consent is what the "Esperando consentimiento" chip already says; only the optional
// purposes (voice, AI scoring, identity check) are worth a line of their own.
const CHIP_SAYS_IT = new Set(['assessment']);

// One provider attempt on the candidate page: the test, its status chip, what it is waiting for, and its result.
export function ProviderAttemptRow({
  attempt,
  dateFormat,
  canCancel,
  cancelling,
  onCancel,
}: {
  attempt: StaffProviderAttempt;
  dateFormat: Intl.DateTimeFormat;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const pa = t.providerAssessments;
  const name = t.candidates.fitInstrumentNames[attempt.instrument];
  const waiting = attempt.missingConsents
    .filter((purpose) => !CHIP_SAYS_IT.has(purpose))
    .map((purpose) => pa.purpose[purpose])
    .join(', ');

  return (
    <li
      className="border-b border-border py-2 last:border-0"
      data-testid="provider-attempt"
      data-instrument={attempt.instrument}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-medium text-brand">{name}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ProviderStatusChip status={attempt.status} />
          {canCancel && CANCELLABLE.has(attempt.status) && (
            <Button
              variant="destructive-secondary"
              size="sm"
              onClick={onCancel}
              disabled={cancelling}
              aria-label={formatMessage(pa.cancelAria, { instrument: name })}
            >
              {pa.cancel}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-secondary">
        {attempt.instrumentVersion && <span>{pa.version.replace('{version}', attempt.instrumentVersion)}</span>}
        {attempt.expiresAt && (attempt.status === 'sent' || attempt.status === 'consent_needed') && (
          <span>{pa.startBy.replace('{date}', dateFormat.format(new Date(attempt.expiresAt)))}</span>
        )}
        {attempt.timeMultiplier !== null && attempt.timeMultiplier > 1 && (
          <span>{pa.extraTime.replace('{multiplier}', String(attempt.timeMultiplier))}</span>
        )}
      </div>
      {waiting && <p className="text-caption text-warning">{pa.awaitingConsent.replace('{purposes}', waiting)}</p>}
      {attempt.speakingNotAssessed && (
        <p className="text-caption text-secondary" data-testid="speaking-not-assessed">
          {pa.speakingNotAssessed[attempt.speakingNotAssessed]}
        </p>
      )}
      {attempt.status === 'pending' && attempt.lastErrorCode && (
        <p className="text-caption text-warning">{pa.pendingError.replace('{code}', attempt.lastErrorCode)}</p>
      )}
      <ProviderProctoringNote outcome={attempt.proctoringOutcome} reasons={attempt.result?.validityReasons} />
      {attempt.result ? (
        <ProviderResultDetail instrument={attempt.instrument} result={attempt.result} countsIn={attempt.countsIn} />
      ) : (
        <p className="text-caption text-secondary">{pa.countsIn[attempt.countsIn]}</p>
      )}
    </li>
  );
}
