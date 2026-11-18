'use client';

import { useI18n } from '../../../../../lib/i18n';
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
    <div className="mt-1 space-y-1 text-[12px]" data-testid="provider-result">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            result.validity === 'valid'
              ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-700'
              : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200'
          }
        >
          {pa.validity[result.validity]}
        </span>
        {level && !result.reviewPending && (
          <span className="text-[#1F114C] font-medium" data-testid="provider-result-level">
            {level}
          </span>
        )}
        {minimum && (
          <span
            data-testid="provider-result-minimum"
            className={result.minimum === 'not_met' ? 'text-[#DD0C15] font-medium' : 'text-[#585858]'}
          >
            {minimum}
          </span>
        )}
      </div>
      {result.reviewPending && (
        <p className="text-amber-700" data-testid="provider-result-review">
          {pa.reviewPending}. {pa.reviewByProvider}
        </p>
      )}
      <p className="text-[11px] text-[#8B8B8B]">{pa.countsIn[countsIn]}</p>
    </div>
  );
}
