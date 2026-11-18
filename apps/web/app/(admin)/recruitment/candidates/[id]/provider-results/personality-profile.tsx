'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { StaffResultProfile } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { AdvisoryNote, fill } from './chart-parts';

type Personality = NonNullable<StaffResultProfile['personality']>;
type Dimension = Personality['dimensions'][number];

/**
 * One bipolar dimension: the two poles at either end and a bar growing from the centre toward the preferred pole by its
 * clarity. A balanced dimension shows only the centre mark. Decorative: the row prints the pole and clarity as text.
 */
function Spectrum({ d }: { d: Dimension }) {
  const half = Math.max(0, Math.min(100, d.clarityPct)) / 2;
  const towardFirst = d.preferredPole === d.firstPole;
  const x = towardFirst ? 50 - half : 50;
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-2.5 w-full" aria-hidden="true">
      <rect x="0" y="2" width="100" height="6" rx="3" className="fill-[#ECEAF3]" />
      {!d.balanced && d.preferredPole !== null && half > 0 && (
        <rect x={x} y="2" width={half} height="6" rx="1.5" className="fill-[#1F114C]" />
      )}
      <line
        x1="50"
        x2="50"
        y1="0"
        y2="10"
        className="stroke-[#333333]"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Personality: the four-letter profile is the headline (a balanced dimension reads "x"), and each dimension is drawn on
// the same centred scale so the reader sees which way, and how clearly, each preference leans.
export function PersonalityProfile({ personality }: { personality: Personality }) {
  const { t } = useI18n();
  const results = t.providerAssessments.results;
  const r = results.personality;
  const poles: Record<string, string> = r.poles;
  const dims: Record<string, string> = r.dimensions;
  const variants: Record<string, string> = r.variants;
  const code = personality.dimensions.map((d) => (d.balanced || !d.preferredPole ? 'x' : d.preferredPole)).join('');

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div>
          <p className="text-[12px] text-[#585858]">{r.headline}</p>
          <p className="text-[28px] font-semibold leading-8 tracking-[0.12em] text-[#1F114C]">{code}</p>
        </div>
        {personality.variant && (
          <p className="pb-1 text-[13px] text-[#333333]">{variants[personality.variant] ?? personality.variant}</p>
        )}
      </div>

      <ul className="mt-5 space-y-4" aria-label={r.chartLabel}>
        {personality.dimensions.map((d) => {
          const lean =
            d.balanced || !d.preferredPole
              ? r.balanced
              : fill(r.clarity, { pole: poles[d.preferredPole] ?? d.preferredPole, value: d.clarityPct });
          return (
            <li key={d.dimension} aria-label={`${dims[d.dimension] ?? d.dimension}: ${lean}`}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium uppercase tracking-wide text-[#6B6B6B]">
                  {dims[d.dimension] ?? d.dimension}
                </span>
                <span className="text-[12px] text-[#1F114C]">{lean}</span>
              </div>
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_6.5rem] items-center gap-3">
                <span
                  className={`truncate text-[13px] ${d.preferredPole === d.firstPole && !d.balanced ? 'font-semibold text-[#1F114C]' : 'text-[#585858]'}`}
                >
                  {poles[d.firstPole] ?? d.firstPole}
                </span>
                <Spectrum d={d} />
                <span
                  className={`truncate text-right text-[13px] ${d.preferredPole === d.secondPole && !d.balanced ? 'font-semibold text-[#1F114C]' : 'text-[#585858]'}`}
                >
                  {poles[d.secondPole] ?? d.secondPole}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <AdvisoryNote text={results.advisoryNote} />
    </div>
  );
}
