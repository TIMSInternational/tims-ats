'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatPercent } from '../../../../lib/format-utils';
import { GENDER_BAR } from './dei-shared';

interface DeiGenderRatioKpiProps {
  male: number;
  female: number;
  nonBinary: number;
}

/** Gender ratio as labelled values with a stacked bar below: never three colour-coded bare numbers. */
export function DeiGenderRatioKpi({ male, female, nonBinary }: DeiGenderRatioKpiProps) {
  const { t, locale } = useI18n();
  const rows = [
    { key: 'male', label: t.dei.genderMale, value: male },
    { key: 'female', label: t.dei.genderFemale, value: female },
    { key: 'non_binary', label: t.dei.genderNonBinary, value: nonBinary },
  ];
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5">
      <p className="mb-2 min-h-8 text-caption font-medium uppercase tracking-wide text-muted">{t.dei.kpiGenderRatio}</p>
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2 text-callout">
            <dt className="flex items-center gap-1.5 text-secondary">
              <span className={`size-2 rounded-sm ${GENDER_BAR[r.key]}`} aria-hidden="true" />
              {r.label}
            </dt>
            <dd className="font-semibold tabular-nums text-primary">{formatPercent(r.value, locale)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.key} className={GENDER_BAR[r.key]} style={{ width: `${r.value}%` }} />
        ))}
      </div>
    </div>
  );
}
