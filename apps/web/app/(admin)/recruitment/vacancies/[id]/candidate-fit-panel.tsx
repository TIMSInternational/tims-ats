'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { RadarChart, Skeleton } from '../../../../../components';

export function CandidateFitPanel({
  candidateId,
  vacancyId,
  onClose,
}: {
  candidateId: string;
  vacancyId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ranking = trpc.fitEngine.getRankingForVacancy.useQuery({ vacancyId });
  const narrative = trpc.fitEngine.explainFit.useQuery({ candidateId, vacancyId });

  const entry = (ranking.data ?? []).find((r) => r.candidateId === candidateId);
  const breakdown = entry?.breakdown;

  const dimensions = [
    { label: t.candidates.fitDimensionAssessment, score: breakdown?.assessment ?? null },
    { label: t.candidates.fitDimensionInterview, score: breakdown?.interview ?? null },
    { label: t.candidates.fitDimensionExperience, score: breakdown?.experience ?? null },
    { label: t.candidates.fitDimensionEducation, score: breakdown?.education ?? null },
    { label: t.candidates.fitDimensionLanguages, score: breakdown?.languages ?? null },
  ];

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mt-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold text-[#1F114C]">
          {entry ? `${entry.firstName} ${entry.lastName}` : ''}
        </h4>
        <button onClick={onClose} className="text-[11px] text-[#8B8B8B] hover:text-[#585858]">
          {t.fitRanking.closeDetail}
        </button>
      </div>

      <RadarChart dimensions={dimensions} />

      <div className="mt-4 pt-4 border-t border-[#F6F6F6]">
        <p className="text-[12px] font-medium text-[#585858] mb-2">{t.fitRanking.narrativeTitle}</p>
        {narrative.isLoading ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : narrative.isError ? (
          <p className="text-[12px] text-[#DD0C15]">{t.fitRanking.narrativeError}</p>
        ) : (
          <p className="text-[12px] text-[#585858] leading-relaxed">{narrative.data?.narrative}</p>
        )}
      </div>
    </div>
  );
}
