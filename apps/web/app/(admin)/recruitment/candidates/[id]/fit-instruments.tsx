'use client';

import { useI18n } from '../../../../../lib/i18n';
import { StatusBadge } from '../../../../../components';
import { fitV2Entries, type FitV2Entry } from '../../../../../lib/fit-v2-breakdown';

// FIT v2: one line per instrument the vacancy uses, under the dimension bars. "Needs review" and "below minimum" are
// shown as words, never as a number (a result awaiting review is not a low score; a team leader sees only that the
// minimum was not reached, owner default D6).
function EntryValue({ entry }: { entry: FitV2Entry }) {
  const { t } = useI18n();
  if (entry.status === 'needs_review') {
    return (
      <span data-testid="fit-instrument-needs-review">
        <StatusBadge tone="warning">{t.candidates.fitInstrumentNeedsReview}</StatusBadge>
      </span>
    );
  }
  if (entry.belowMinimum) {
    return (
      <span data-testid="fit-instrument-below-minimum" className="font-semibold text-danger">
        {t.candidates.fitInstrumentBelowMinimum}
      </span>
    );
  }
  if (entry.status === 'no_result') return <span className="text-secondary">{t.candidates.fitInstrumentNoResult}</span>;
  if (entry.status === 'no_value') return <span className="text-secondary">{t.candidates.fitInstrumentNoValue}</span>;
  if (entry.use === 'advisory') return <span className="text-secondary">{t.candidates.fitInstrumentAdvisory}</span>;
  if (entry.use === 'gate') {
    const label =
      entry.gate === 'met'
        ? t.candidates.fitInstrumentGateMet
        : entry.gate === 'not_met'
          ? t.candidates.fitInstrumentGateNotMet
          : t.candidates.fitInstrumentGateUnknown;
    return <span className="font-medium text-brand">{label}</span>;
  }
  return (
    <span className="font-medium tabular-nums text-brand">
      {entry.score === null ? t.candidates.fitDimensionUnavailable : `${entry.score}/100`}
    </span>
  );
}

export function FitInstruments({ breakdown }: { breakdown: unknown }) {
  const { t } = useI18n();
  const entries = fitV2Entries(breakdown);
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="fit-instruments">
      <p className="mb-2 text-callout font-medium text-secondary">{t.candidates.fitInstrumentsTitle}</p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.instrument} className="flex justify-between gap-2 text-callout">
            <span className="text-secondary">
              {t.candidates.fitInstrumentNames[entry.instrument]}
              {entry.jobCode && ` · ${t.candidates.fitInstrumentJobCode.replace('{code}', entry.jobCode)}`}
            </span>
            <EntryValue entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}
