'use client';

import { trpc } from '../../../lib/trpc';
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
  const cycles = trpc.evaluation360.myReportCycles.useQuery();

  return (
    <section>
      <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.my360.reportsTitle}</h2>

      <p className="text-[11px] text-[#8B8B8B] mb-4">{t.my360.anonymityNote}</p>

      {cycles.isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : cycles.isError ? (
        <ErrorState onRetry={() => cycles.refetch()} />
      ) : (cycles.data ?? []).length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-8 h-8 text-[#B8B8B8]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
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
