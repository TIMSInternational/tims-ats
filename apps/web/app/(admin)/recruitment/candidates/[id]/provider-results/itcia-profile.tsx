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
      <p className="text-callout text-secondary">{r.headline}</p>
      {level === null ? (
        <p className="text-body text-muted">{r.noLevel}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[22px] font-semibold leading-8 text-brand">{levelNames[String(level)]}</p>
          <LevelDots level={level} max={MAX_LEVEL} />
          <span className="text-callout text-secondary">
            {fill(t.providerAssessments.results.levelOf, { value: level, max: MAX_LEVEL })}
          </span>
        </div>
      )}
      {minimum !== null && <p className="mt-1 text-caption text-secondary">{fill(r.minimum, { value: minimum })}</p>}
      {itcia.coreScore !== null && (
        <div className="mt-3 max-w-md">
          <p className="text-callout text-primary">{fill(r.core, { value: evidence(itcia.coreScore) })}</p>
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
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3.5rem] sm:gap-y-3"
                aria-label={c.score === null ? name : fill(r.categoryValue, { name, value: evidence(c.score) })}
              >
                <span className="text-body text-primary sm:truncate">{name}</span>
                <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                  <MeterBar value={c.score} max={MAX_EVIDENCE} />
                </div>
                <span className="text-right text-body font-medium tabular-nums text-brand">
                  {c.score === null ? '—' : evidence(c.score)}
                </span>
                {notes.length > 0 && (
                  <span className="order-last col-span-2 text-caption text-muted sm:col-span-1 sm:col-start-2 sm:-mt-2">
                    {notes.join(' · ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {itcia.completion === 'partial' && <p className="mt-3 text-callout text-muted">{r.partialSession}</p>}

      <div className="mt-5 border-t border-border pt-3">
        <p className="text-body font-semibold text-brand">{r.risksTitle}</p>
        {itcia.riskFlags.length === 0 ? (
          <p className="mt-1 text-callout text-secondary">{r.noRisks}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-body text-primary">
            {itcia.riskFlags.map((flag) => (
              <li key={flag}>
                {flag} · {flagNames[flag] ?? flag}
              </li>
            ))}
          </ul>
        )}
        {itcia.recommendedAutonomyLevel !== null && (
          <p className="mt-2 text-callout text-primary">
            {fill(r.recommendedAutonomy, { level: levelNames[String(itcia.recommendedAutonomyLevel)] })}
          </p>
        )}
      </div>
      <p className="mt-4 text-callout text-muted">{r.provisionalScale}</p>
    </div>
  );
}
