'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { StaffResultProfile } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { fill, LevelDots, MeterBar } from './chart-parts';

type Itcia = NonNullable<StaffResultProfile['itcia']>;

const MAX_LEVEL = 5;
const MAX_EVIDENCE = 3;

/** 1.92 → "1.92", 2 → "2": the 0–3 evidence scale is read to two decimals. */
const evidence = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

// ITC-IA: the global level (1–5) is the headline, as a vacancy's minimum is judged on it; the seven categories sit under
// it on one shared 0–3 evidence scale, each value printed beside its bar. The critical flags follow, with the autonomy the
// instrument recommends: TIMS shows them to HR only.
export function ItciaProfile({ itcia, minimum }: { itcia: Itcia; minimum: number | null }) {
  const { t } = useI18n();
  const r = t.providerAssessments.results.itcia;
  const levelNames: Record<string, string> = r.levelNames;
  const categoryNames: Record<string, string> = r.categories;
  const flagNames: Record<string, string> = r.flags;
  const level = itcia.globalLevel;

  return (
    <div>
      <p className="text-[12px] text-[#585858]">{r.headline}</p>
      {level === null ? (
        <p className="text-[13px] text-[#6B6B6B]">{r.noLevel}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[22px] font-semibold leading-8 text-[#1F114C]">{levelNames[String(level)]}</p>
          <LevelDots level={level} max={MAX_LEVEL} />
          <span className="text-[12px] text-[#585858]">
            {fill(t.providerAssessments.results.levelOf, { value: level, max: MAX_LEVEL })}
          </span>
        </div>
      )}
      {minimum !== null && <p className="mt-1 text-[11px] text-[#585858]">{fill(r.minimum, { value: minimum })}</p>}
      {itcia.coreScore !== null && (
        <div className="mt-3 max-w-md">
          <p className="text-[12px] text-[#333333]">{fill(r.core, { value: evidence(itcia.coreScore) })}</p>
          <MeterBar value={itcia.coreScore} max={MAX_EVIDENCE} />
        </div>
      )}

      {itcia.categories.length > 0 && (
        <ul className="mt-5 space-y-3" aria-label={r.chartLabel}>
          {itcia.categories.map((c) => {
            const name = categoryNames[c.category] ?? c.category;
            const notes = [c.provisional && r.provisional, c.coverage === 'partial' && r.partialCoverage].filter(
              (note): note is string => typeof note === 'string',
            );
            return (
              <li
                key={c.category}
                className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3.5rem] items-center gap-3"
                aria-label={c.score === null ? name : fill(r.categoryValue, { name, value: evidence(c.score) })}
              >
                <span className="truncate text-[13px] text-[#333333]">{name}</span>
                <MeterBar value={c.score} max={MAX_EVIDENCE} />
                <span className="text-right text-[13px] font-medium tabular-nums text-[#1F114C]">
                  {c.score === null ? '—' : evidence(c.score)}
                </span>
                {notes.length > 0 && (
                  <span className="col-start-2 -mt-2 text-[11px] text-[#6B6B6B]">{notes.join(' · ')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {itcia.completion === 'partial' && <p className="mt-3 text-[12px] text-[#6B6B6B]">{r.partialSession}</p>}

      <div className="mt-5 border-t border-[#F1F0F5] pt-3">
        <p className="text-[13px] font-semibold text-[#1F114C]">{r.risksTitle}</p>
        {itcia.riskFlags.length === 0 ? (
          <p className="mt-1 text-[12px] text-[#585858]">{r.noRisks}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-[#333333]">
            {itcia.riskFlags.map((flag) => (
              <li key={flag}>
                {flag} · {flagNames[flag] ?? flag}
              </li>
            ))}
          </ul>
        )}
        {itcia.recommendedAutonomyLevel !== null && (
          <p className="mt-2 text-[12px] text-[#333333]">
            {fill(r.recommendedAutonomy, { level: levelNames[String(itcia.recommendedAutonomyLevel)] })}
          </p>
        )}
      </div>
      <p className="mt-4 text-[12px] text-[#6B6B6B]">{r.provisionalScale}</p>
    </div>
  );
}
