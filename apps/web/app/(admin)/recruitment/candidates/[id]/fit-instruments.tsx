'use client';

import { useI18n } from '../../../../../lib/i18n';
import { fitV2Entries, type FitV2Entry } from '../../../../../lib/fit-v2-breakdown';

// FIT v2: one line per instrument the vacancy uses, under the dimension bars. "Needs review" and "below minimum" are
// shown as words, never as a number (a result awaiting review is not a low score; a team leader sees only that the
// minimum was not reached, owner default D6).
function EntryValue({ entry }: { entry: FitV2Entry }) {
  const { t } = useI18n();
  if (entry.status === 'needs_review') {
    return (
      <span data-testid="fit-instrument-needs-review" className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 text-[10px] font-medium">
        {t.candidates.fitInstrumentNeedsReview}
      </span>
    );
  }
  if (entry.belowMinimum) {
    return <span data-testid="fit-instrument-below-minimum" className="text-[#DD0C15] font-medium">{t.candidates.fitInstrumentBelowMinimum}</span>;
  }
  if (entry.status === 'no_result') return <span className="text-[#8B8B8B]">{t.candidates.fitInstrumentNoResult}</span>;
  if (entry.status === 'no_value') return <span className="text-[#8B8B8B]">{t.candidates.fitInstrumentNoValue}</span>;
  if (entry.use === 'advisory') return <span className="text-[#8B8B8B]">{t.candidates.fitInstrumentAdvisory}</span>;
  if (entry.use === 'gate') {
    const label =
      entry.gate === 'met'
        ? t.candidates.fitInstrumentGateMet
        : entry.gate === 'not_met'
          ? t.candidates.fitInstrumentGateNotMet
          : t.candidates.fitInstrumentGateUnknown;
    return <span className="text-[#1F114C] font-medium">{label}</span>;
  }
  return <span className="text-[#1F114C] font-medium">{entry.score === null ? t.candidates.fitDimensionUnavailable : `${entry.score}/100`}</span>;
}

export function FitInstruments({ breakdown }: { breakdown: unknown }) {
  const { t } = useI18n();
  const entries = fitV2Entries(breakdown);
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-[#F6F6F6]" data-testid="fit-instruments">
      <p className="text-[12px] font-medium text-[#585858] mb-2">{t.candidates.fitInstrumentsTitle}</p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.instrument} className="flex justify-between text-[12px]">
            <span className="text-[#585858]">{t.candidates.fitInstrumentNames[entry.instrument]}</span>
            <EntryValue entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}
