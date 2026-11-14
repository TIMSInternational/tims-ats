'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { StaffResultProfile } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { fill, formatNumber, MeterBar } from './chart-parts';

type Lia = NonNullable<StaffResultProfile['lia']>;

// LIA: the global percentile is the headline (it is what a vacancy's minimum is judged on); the five subtests sit under
// it on one shared 0–100 scale, so a reader compares them by length and reads the exact value beside each.
export function LiaProfile({ lia, minimum }: { lia: Lia; minimum: number | null }) {
  const { t } = useI18n();
  const r = t.providerAssessments.results.lia;
  const levels: Record<string, string> = r.levels;
  const names: Record<string, string> = r.subtests;
  const global = lia.globalPercentile;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div>
          <p className="text-callout text-secondary">{r.headline}</p>
          <p className="text-[28px] font-semibold leading-8 tabular-nums text-brand">
            {global === null ? '—' : formatNumber(global)}
          </p>
        </div>
        {lia.globalLevel && (
          <p className="pb-1 text-body font-medium text-primary">{levels[lia.globalLevel] ?? lia.globalLevel}</p>
        )}
      </div>
      {global !== null && (
        <div className="mt-2 max-w-md">
          <MeterBar value={global} minimum={minimum} />
          {minimum !== null && (
            <p className="mt-1 text-caption text-secondary">
              {fill(t.providerAssessments.results.minimum, { value: formatNumber(minimum) })}
            </p>
          )}
        </div>
      )}

      {lia.subtests.length > 0 && (
        <ul className="mt-5 space-y-3" aria-label={r.chartLabel}>
          {lia.subtests.map((s) => {
            const name = names[s.subtest] ?? s.subtest;
            const finished = s.completion === null || s.completion === 'finished';
            return (
              <li
                key={s.subtest}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] sm:gap-y-3"
                aria-label={
                  s.percentile === null ? name : fill(r.subtestValue, { name, value: formatNumber(s.percentile) })
                }
              >
                <span className="text-body text-primary sm:truncate">{name}</span>
                <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                  <MeterBar value={s.percentile} />
                </div>
                <span className="text-right text-body font-medium tabular-nums text-brand">
                  {s.percentile === null ? '—' : formatNumber(s.percentile)}
                </span>
                {!finished && (
                  <span className="order-last col-span-2 text-caption text-muted sm:col-span-1 sm:col-start-2 sm:-mt-2">
                    {r.notFinished}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lia.normStatus === 'provisional' && <p className="mt-4 text-callout text-muted">{r.provisionalNorms}</p>}
    </div>
  );
}
