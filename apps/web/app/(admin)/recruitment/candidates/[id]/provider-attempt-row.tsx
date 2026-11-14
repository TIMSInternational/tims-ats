'use client';

import { useI18n } from '../../../../../lib/i18n';
import type { StaffProviderAttempt } from '../../../../../lib/platform-api/assessment-providers-staff';
import { ProviderStatusChip } from './provider-status-chip';
import { ProviderResultDetail } from './provider-result-detail';
import { ProviderProctoringNote } from './provider-proctoring-note';

const CANCELLABLE = new Set(['pending', 'consent_needed', 'sent', 'in_progress']);

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
  const waiting = attempt.missingConsents.map((purpose) => pa.purpose[purpose]).join(', ');

  return (
    <li
      className="py-2 border-b border-[#F6F6F6] last:border-0"
      data-testid="provider-attempt"
      data-instrument={attempt.instrument}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-[#1F114C]">{name}</span>
        <div className="flex items-center gap-2">
          <ProviderStatusChip status={attempt.status} />
          {canCancel && CANCELLABLE.has(attempt.status) && (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              aria-label={pa.cancelAria.replace('{instrument}', name)}
              className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
            >
              {pa.cancel}
            </button>
          )}
        </div>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[#8B8B8B]">
        {attempt.instrumentVersion && <span>{pa.version.replace('{version}', attempt.instrumentVersion)}</span>}
        {attempt.expiresAt && (attempt.status === 'sent' || attempt.status === 'consent_needed') && (
          <span>{pa.startBy.replace('{date}', dateFormat.format(new Date(attempt.expiresAt)))}</span>
        )}
        {attempt.timeMultiplier !== null && attempt.timeMultiplier > 1 && (
          <span>{pa.extraTime.replace('{multiplier}', String(attempt.timeMultiplier))}</span>
        )}
      </div>
      {waiting && <p className="text-[11px] text-amber-700">{pa.awaitingConsent.replace('{purposes}', waiting)}</p>}
      {attempt.speakingNotAssessed && (
        <p className="text-[11px] text-[#585858]" data-testid="speaking-not-assessed">
          {pa.speakingNotAssessed[attempt.speakingNotAssessed]}
        </p>
      )}
      {attempt.status === 'pending' && attempt.lastErrorCode && (
        <p className="text-[11px] text-amber-700">{pa.pendingError.replace('{code}', attempt.lastErrorCode)}</p>
      )}
      <ProviderProctoringNote outcome={attempt.proctoringOutcome} reasons={attempt.result?.validityReasons} />
      {attempt.result ? (
        <ProviderResultDetail instrument={attempt.instrument} result={attempt.result} countsIn={attempt.countsIn} />
      ) : (
        <p className="text-[11px] text-[#8B8B8B]">{pa.countsIn[attempt.countsIn]}</p>
      )}
    </li>
  );
}
