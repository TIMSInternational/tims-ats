'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { StaffResultProfile } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { AdvisoryNote, fill, MeterBar } from './chart-parts';

type Mi = NonNullable<StaffResultProfile['mi']>;

const MAX_SUM = 25;

// MI (advisory, a self-report): the dominant intelligences first, then all ten on one shared scale (the sum of five
// ratings, 5–25) with the band TIMS gives each. An intelligence not fully answered shows no sum and no band.
export function MiProfile({ mi }: { mi: Mi }) {
  const { t } = useI18n();
  const r = t.providerAssessments.results.mi;
  const names: Record<string, string> = r.intelligences;
  const bands: Record<string, string> = r.bands;
  const nameOf = (id: string) => names[id] ?? id;

  return (
    <div>
      <p className="text-callout text-secondary">{r.headline}</p>
      {mi.noDifferentiation ? (
        <p className="text-body text-primary">{r.noDifferentiation}</p>
      ) : (
        <p className="text-[17px] font-semibold text-brand">{mi.dominant.map(nameOf).join(' · ')}</p>
      )}
      {mi.tied && !mi.noDifferentiation && <p className="mt-1 text-callout text-secondary">{r.tied}</p>}

      <ul className="mt-5 space-y-3" aria-label={r.chartLabel}>
        {mi.intelligences.map((i) => {
          const name = nameOf(i.intelligence);
          const band = i.bandCode === null ? null : (bands[i.bandCode] ?? i.bandCode);
          return (
            <li
              key={i.intelligence}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] sm:gap-y-3"
              aria-label={
                i.sumScore === null
                  ? `${name}: ${r.notAnswered}`
                  : fill(r.intelligenceValue, { name, value: i.sumScore, band: band ?? '' })
              }
            >
              <span className="text-body text-primary sm:truncate">{name}</span>
              <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                <MeterBar value={i.sumScore} max={MAX_SUM} />
              </div>
              <span className="whitespace-nowrap text-right text-callout text-brand">
                {i.sumScore === null ? r.notAnswered : `${fill(r.outOf, { value: i.sumScore })} · ${band ?? ''}`}
              </span>
            </li>
          );
        })}
      </ul>
      {!mi.allComplete && <p className="mt-3 text-callout text-muted">{r.incomplete}</p>}
      <AdvisoryNote text={r.note} />
    </div>
  );
}
