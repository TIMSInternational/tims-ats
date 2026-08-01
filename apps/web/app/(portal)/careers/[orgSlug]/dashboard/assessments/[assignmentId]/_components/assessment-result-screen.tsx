'use client';

import { useI18n } from '../../../../../../../../lib/i18n';

type ScoreBand = 'below_average' | 'average' | 'above_average' | 'excellent';

interface AssessmentResultScreenProps {
  normalizedScore: number | null;
  hasPending: boolean;
  band: ScoreBand | null;
  percentile: number | null;
  normSampleSize: number | null;
}

export function AssessmentResultScreen({
  normalizedScore,
  hasPending,
  band,
  percentile,
  normSampleSize,
}: AssessmentResultScreenProps) {
  const { t } = useI18n();
  const roundedScore = normalizedScore !== null ? Math.round(normalizedScore) : null;
  const roundedPercentile = percentile !== null ? Math.round(percentile) : null;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full text-center space-y-4">
        <h1 className="text-lg font-semibold text-[#1F114C]">{t.assessmentPlayer.resultTitle}</h1>
        {roundedScore !== null && (
          <p className="text-3xl font-bold text-[#1F114C]">
            {t.assessmentPlayer.resultScoreLabel} {roundedScore}%
          </p>
        )}
        {!hasPending && band !== null && roundedPercentile !== null && (
          <p className="text-[13px] font-medium text-[#1F114C]">
            <span>{t.assessmentPlayer.bandLabels[band]}</span> —{' '}
            <span>{t.assessmentPlayer.resultPercentileLabel.replace('{percentile}', String(roundedPercentile))}</span>
          </p>
        )}
        {!hasPending && band === null && normSampleSize !== null && (
          <p className="text-[13px] text-[#8B8B8B]">{t.assessmentPlayer.resultNoNormData}</p>
        )}
        {hasPending && (
          <p className="text-[13px] text-[#B45309] bg-[#FFFBEB] rounded-xl p-3">
            {t.assessmentPlayer.resultPendingNotice}
          </p>
        )}
        <p className="text-[13px] text-[#585858]">{t.assessmentPlayer.resultSummary}</p>
      </div>
    </div>
  );
}
