'use client';

import { useI18n, formatMessage } from '../../../lib/i18n';
import { formatNumber } from '../../../lib/format-utils';
import { ProgressBar } from '../../../components';
import type { Eval360ReportBucket } from '../../../lib/trpc-types';

interface ReportBucketCardProps {
  bucket: Eval360ReportBucket;
}

/** One relationship bucket of a published 360 report. `bucket` is exactly
 * what the server chose to send — see the anonymity note rendered by the
 * parent section (my-report-section.tsx) for why a sub-threshold peer/
 * direct_report group never reaches this component at all (suppressed by
 * omission server-side, not filtered here). `comments` is only ever
 * populated for self/manager (never peer/direct_report). */
export function ReportBucketCard({ bucket }: ReportBucketCardProps) {
  const { t, locale } = useI18n();

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-body font-semibold text-primary">{t.my360.relationshipLabels[bucket.relationship]}</h4>
        <span className="shrink-0 text-callout text-secondary">
          {formatMessage(t.my360.raterCountLabel, { n: bucket.raterCount })}
        </span>
      </div>

      <ul className="space-y-2">
        {bucket.competencies.map((c) => {
          const label = t.my360.competencyLabels[c.competencyKey];
          const average = formatNumber(c.average, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          const valueText = formatMessage(t.my360.averageOfFive, { n: average });
          return (
            <li key={c.competencyKey} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-callout text-secondary sm:w-32">{label}</span>
              <ProgressBar value={c.average} max={5} kind="meter" label={label} valueText={valueText} hideLabel className="flex-1" />
              <span className="w-14 shrink-0 text-right text-callout font-medium tabular-nums text-primary" aria-hidden="true">
                {valueText}
              </span>
            </li>
          );
        })}
      </ul>

      {bucket.comments && bucket.comments.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          {bucket.comments.map((comment, i) => (
            <p key={i} className="text-body italic text-secondary">
              &ldquo;{comment}&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
