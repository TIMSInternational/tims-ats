'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { StaffResultProfile } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { fill, formatNumber } from './chart-parts';

type English = NonNullable<StaffResultProfile['english']>;
const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
/** The vacancy minimum's step on the ladder: a dashed outline (shape, not colour). */
const MINIMUM_STEP = 'outline outline-1 outline-offset-1 outline-dashed outline-[#333333]';

/** The CEFR ladder of one skill: six steps, filled up to the level; the vacancy minimum's step is outlined. */
function Ladder({ level, minimum }: { level: string | null; minimum: string | null }) {
  const reached = level === null ? -1 : CEFR.indexOf(level as (typeof CEFR)[number]);
  const required = minimum === null ? -1 : CEFR.indexOf(minimum as (typeof CEFR)[number]);
  return (
    <span className="grid grid-cols-6 gap-1" aria-hidden="true">
      {CEFR.map((step, i) => (
        <span
          key={step}
          className={`h-2.5 rounded-sm ${i <= reached ? 'bg-brand' : 'bg-[#ECEAF3]'} ${i === required ? MINIMUM_STEP : ''}`}
        />
      ))}
    </span>
  );
}

// English: the overall CEFR level is the headline; each skill gets the same six-step ladder so levels line up in
// columns. A skill that was not assessed says why, in words, instead of showing an empty ladder as a zero.
export function EnglishProfile({ english, minimum }: { english: English; minimum: string | null }) {
  const { t } = useI18n();
  const r = t.providerAssessments.results.english;
  const skills: Record<string, string> = r.skills;
  const reasons: Record<string, string> = r.notAssessed;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div>
          <p className="text-callout text-secondary">{r.headline}</p>
          <p className="text-[28px] font-semibold leading-8 text-brand">{english.overallCefr ?? '—'}</p>
        </div>
        {english.overallScorePct !== null && (
          <p className="pb-1 text-body text-primary">
            {fill(r.scorePct, { value: formatNumber(english.overallScorePct) })}
          </p>
        )}
      </div>
      {english.overallCefr !== null && (
        <div className="mt-2 max-w-md">
          <Ladder level={english.overallCefr} minimum={minimum} />
          {minimum !== null && (
            <p className="mt-1 text-caption text-secondary">
              {fill(t.providerAssessments.results.minimum, { value: minimum })}
            </p>
          )}
        </div>
      )}

      <div className="mt-5" role="group" aria-label={r.chartLabel}>
        <div className="mb-1 hidden grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] gap-3 sm:grid" aria-hidden="true">
          <span />
          <span className="grid grid-cols-6 gap-1 text-center text-caption text-muted">
            {CEFR.map((step) => (
              <span key={step}>{step}</span>
            ))}
          </span>
          <span />
        </div>
        <ul className="space-y-3">
          {english.skills.map((s) => {
            const name = skills[s.skill] ?? s.skill;
            if (!s.assessed) {
              return (
                <li
                  key={s.skill}
                  className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3"
                >
                  <span className="text-body text-primary sm:truncate">{name}</span>
                  <span className="text-callout text-muted">
                    {reasons[s.notAssessedReason ?? 'other'] ?? reasons.other}
                  </span>
                </li>
              );
            }
            return (
              <li
                key={s.skill}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] sm:gap-y-3"
                aria-label={fill(r.skillValue, { name, level: s.cefr ?? '—' })}
              >
                <span className="text-body text-primary sm:truncate">{name}</span>
                <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                  <Ladder level={s.cefr} minimum={null} />
                </div>
                <span className="text-right text-body font-medium text-brand">{s.cefr ?? '—'}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
