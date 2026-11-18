'use client';

import { useEvaluation360MyReport } from '../../../lib/platform-api/evaluation360';
import { useI18n } from '../../../lib/i18n';
import { Skeleton, ErrorState } from '../../../components';
import { ReportBucketCard } from './report-bucket-card';

interface CycleReportCardProps {
  cycleId: string;
}

/** Fetches and renders ONE published cycle's report (evaluation360.myReport).
 * Isolated per-cycle so each cycle's query loads/errors independently — the
 * parent section only knows the list of cycleIds (myReportCycles), not their
 * report contents. */
export function CycleReportCard({ cycleId }: CycleReportCardProps) {
  const { t } = useI18n();
  const report = useEvaluation360MyReport(cycleId);

  return (
    <article className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5">
      {report.isLoading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : report.isError ? (
        <ErrorState size="compact" error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <>
          <h3 className="mb-3 text-subheading font-semibold text-primary">{report.data?.cycleName}</h3>
          <div className="space-y-3">
            {(report.data?.buckets ?? []).map((bucket) => (
              <ReportBucketCard key={bucket.relationship} bucket={bucket} />
            ))}
          </div>
          {(report.data?.buckets.length ?? 0) === 0 && (
            <p className="text-body text-secondary">{t.my360.cycleReportEmpty}</p>
          )}
        </>
      )}
    </article>
  );
}
