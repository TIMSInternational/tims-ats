'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../../../components';
import type { VacancyStats } from '../../../../../lib/trpc-types';

interface CandidatesSummaryProps {
  vacancyId: string;
  stats: VacancyStats | null;
  isLoading: boolean;
  isError?: boolean;
}

export function CandidatesSummary({ vacancyId, stats, isLoading, isError }: CandidatesSummaryProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <Skeleton className="h-4 w-32 mb-3 rounded" />
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="flex-1 h-16 rounded-lg" />)}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-3 w-full rounded" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.vacancies.candidatesAssociated}</h3>
        <ErrorState />
      </div>
    );
  }

  if (!stats) return null;

  const total = stats.totalApplications;
  const active = stats.activeApplications;
  const rejected = stats.rejectedApplications;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.vacancies.candidatesAssociated}</h3>
        <Link href={`/recruitment/pipeline?vacancy=${vacancyId}`} className="text-[12px] text-[#DD0C15] font-medium cursor-pointer">
          {t.vacancies.viewAllCandidates}
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 bg-[#F6F6F6] rounded-lg p-2.5 text-center">
          <p className="text-[18px] font-bold text-[#1F114C]">{total}</p>
          <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.total}</p>
        </div>
        <div className="flex-1 bg-green-50 rounded-lg p-2.5 text-center">
          <p className="text-[18px] font-bold text-green-600">{active}</p>
          <p className="text-[10px] text-green-600">{t.vacancies.inProcess}</p>
        </div>
        <div className="flex-1 bg-red-50 rounded-lg p-2.5 text-center">
          <p className="text-[18px] font-bold text-[#DD0C15]">{rejected}</p>
          <p className="text-[10px] text-[#DD0C15]">{t.vacancies.rejected}</p>
        </div>
      </div>

      {/* Stage Breakdown */}
      {stats.stageBreakdown.length > 0 && (
        <>
          <p className="text-[11px] text-[#585858] font-medium mb-2">{t.vacancies.currentPipeline}</p>
          <div className="space-y-1.5">
            {stats.stageBreakdown.map((stage, i) => {
              const pct = total > 0 ? (stage.count / total) * 100 : 0;
              const colorIntensity = Math.min(90, 20 + (i / Math.max(stats.stageBreakdown.length - 1, 1)) * 70);
              return (
                <div key={stage.stageId} className="flex items-center gap-2">
                  <span className="text-[11px] text-[#585858] w-20 truncate">{stage.stageName}</span>
                  <div className="flex-1 bg-[#F6F6F6] rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.max(pct, 3)}%`,
                        backgroundColor: `hsl(260, 30%, ${100 - colorIntensity}%)`,
                      }}
                    />
                  </div>
                  <span className="text-[11px] text-[#1F114C] font-medium w-6 text-right">{stage.count}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
