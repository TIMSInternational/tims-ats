'use client';

import { useI18n } from '../../../lib/i18n';
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
  const { t } = useI18n();

  return (
    <div className="border border-[#EDEDED] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <p className="text-[12px] font-semibold text-[#1F114C]">{t.my360.relationshipLabels[bucket.relationship]}</p>
        <span className="text-[11px] text-[#8B8B8B] shrink-0">
          {t.my360.raterCountLabel.replace('{n}', String(bucket.raterCount))}
        </span>
      </div>

      <div className="space-y-2">
        {bucket.competencies.map((c) => (
          <div key={c.competencyKey} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-[11px] text-[#585858]">
              {t.my360.competencyLabels[c.competencyKey]}
            </span>
            <div className="flex-1 h-2 bg-[#F6F6F6] rounded-full overflow-hidden">
              <div className="h-full bg-[#1F114C] rounded-full" style={{ width: `${(c.average / 5) * 100}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[11px] text-[#333] font-medium">{c.average.toFixed(1)}</span>
          </div>
        ))}
      </div>

      {bucket.comments && bucket.comments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#F6F6F6] space-y-1.5">
          {bucket.comments.map((comment, i) => (
            <p key={i} className="text-[12px] text-[#585858] italic">
              &ldquo;{comment}&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
