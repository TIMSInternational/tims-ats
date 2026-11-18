'use client';

import { useEvaluation360MyReportCycles } from '../../../lib/platform-api/evaluation360';
import { useI18n } from '../../../lib/i18n';
import { Skeleton, ErrorState, EmptyState } from '../../../components';
import { CycleReportCard } from './cycle-report-card';

/** "My Reports" zone: one CycleReportCard per PUBLISHED cycle the caller is
 * a subject of (evaluation360.myReportCycles), plus a STATIC, UNCONDITIONAL
 * anonymity note.
 *
 * CRITICAL anonymity rule: myReport's `buckets` array only ever contains
 * SHOWN buckets — self/manager (always), and peer/direct_report ONLY when
 * >=3 raters responded. A sub-threshold peer/direct_report bucket is
 * OMITTED from the array entirely (suppress-by-omission, server-side) — it
 * is never rendered here as "N responded" or "insufficient responses", and
 * this component never infers or displays a sub-threshold count. The note
 * below is the ONLY messaging about the threshold, and it never varies by
 * data — varying it per-bucket-presence would itself leak the count.
 */
export function MyReportSection() {
  const { t } = useI18n();
  const cycles = useEvaluation360MyReportCycles();

  return (
    <section>
      <h2 className="mb-3 text-heading font-semibold text-primary">{t.my360.reportsTitle}</h2>

      <p className="mb-4 flex max-w-prose items-start gap-2 text-callout text-secondary">
        <svg className="mt-0.5 size-4 shrink-0 text-info" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <span>{t.my360.anonymityNote}</span>
      </p>

      {cycles.isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : cycles.isError ? (
        <ErrorState error={cycles.error} onRetry={() => cycles.refetch()} />
      ) : (cycles.data ?? []).length === 0 ? (
        <EmptyState
          className="rounded-xl border border-border bg-white"
          icon={
            <svg className="size-8" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          message={t.my360.reportsEmpty}
          description={t.my360.reportsEmptyDescription}
        />
      ) : (
        <div className="space-y-4">
          {(cycles.data ?? []).map((c) => (
            <CycleReportCard key={c.cycleId} cycleId={c.cycleId} />
          ))}
        </div>
      )}
    </section>
  );
}
