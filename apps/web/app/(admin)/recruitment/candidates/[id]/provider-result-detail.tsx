'use client';

import { useI18n } from '../../../../../lib/i18n';
import { StatusBadge } from '../../../../../components';
import type {
  CountsIn,
  ProviderInstrument,
  StaffProviderResult,
} from '../../../../../lib/platform-api/assessment-providers-staff';

// One provider result for HR: its validity, whether FIT is holding it for review, the level (only when the C# read
// returns it: HR and admins; a team leader gets null, owner default D6) and whether the vacancy's minimum is met. A
// result awaiting review is never shown as a low score, and its minimum reads "unknown".
export function ProviderResultDetail({
  instrument,
  result,
  countsIn,
}: {
  instrument: ProviderInstrument;
  result: StaffProviderResult;
  countsIn: CountsIn;
}) {
  const { t } = useI18n();
  const pa = t.providerAssessments;
  const level =
    result.globalPercentile !== null
      ? pa.levelPercentile.replace('{value}', String(result.globalPercentile))
      : result.cefr !== null
        ? pa.levelCefr.replace('{value}', result.cefr)
        : result.level !== null && instrument === 'itcia'
          ? pa.levelItcia.replace('{value}', String(result.level))
          : null;
  const minimum =
    result.minimum === 'met'
      ? pa.minimumMet
      : result.minimum === 'not_met'
        ? pa.minimumNotMet
        : result.minimum === 'unknown'
          ? pa.minimumUnknown
          : null;

  return (
    <div className="mt-1 space-y-1 text-callout" data-testid="provider-result">
      {/* One line: level · minimum · where it counts. A valid result needs no "Válido" chip; anything else does. */}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {result.validity !== 'valid' && (
          <StatusBadge tone={result.validity === 'voided' ? 'danger' : 'warning'}>
            {pa.validity[result.validity]}
          </StatusBadge>
        )}
        {level && !result.reviewPending && (
          <span className="font-medium text-brand" data-testid="provider-result-level">
            {level}
          </span>
        )}
        {minimum && (
          <span
            data-testid="provider-result-minimum"
            className={result.minimum === 'not_met' ? 'font-semibold text-danger' : 'text-secondary'}
          >
            {minimum}
          </span>
        )}
        <span aria-hidden="true" className="text-muted">
          ·
        </span>
        <span className="text-secondary">{pa.countsIn[countsIn]}</span>
      </p>
      {result.reviewPending && (
        <p className="text-warning" data-testid="provider-result-review">
          {pa.reviewPending}. {pa.reviewByProvider}
        </p>
      )}
    </div>
  );
}
