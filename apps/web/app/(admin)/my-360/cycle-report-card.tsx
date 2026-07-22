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
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      {report.isLoading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : report.isError ? (
        <ErrorState onRetry={() => report.refetch()} />
      ) : (
        <>
          <p className="text-[13px] font-semibold text-[#1F114C] mb-3">{report.data?.cycleName}</p>
          <div className="space-y-3">
            {(report.data?.buckets ?? []).map((bucket) => (
              <ReportBucketCard key={bucket.relationship} bucket={bucket} />
            ))}
          </div>
          {(report.data?.buckets.length ?? 0) === 0 && (
            <p className="text-[12px] text-[#8B8B8B]">{t.my360.cycleReportEmpty}</p>
          )}
        </>
      )}
    </div>
  );
}
