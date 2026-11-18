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
    <div className="flex justify-center">
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 text-center shadow-card sm:p-8">
        <h1 className="font-display text-title font-semibold text-brand">{t.assessmentPlayer.resultTitle}</h1>
        {roundedScore !== null && (
          <p className="font-display text-display font-bold tabular-nums text-brand">
            {t.assessmentPlayer.resultScoreLabel} {roundedScore}%
          </p>
        )}
        {!hasPending && band !== null && roundedPercentile !== null && (
          <p className="text-body font-medium text-brand">
            <span>{t.assessmentPlayer.bandLabels[band]}</span> —{' '}
            <span>{t.assessmentPlayer.resultPercentileLabel.replace('{percentile}', String(roundedPercentile))}</span>
          </p>
        )}
        {!hasPending && band === null && normSampleSize !== null && (
          <p className="text-body text-secondary">{t.assessmentPlayer.resultNoNormData}</p>
        )}
        {hasPending && (
          <p className="rounded-xl bg-warning-bg p-3 text-body text-warning">
            {t.assessmentPlayer.resultPendingNotice}
          </p>
        )}
        <p className="text-body text-secondary">{t.assessmentPlayer.resultSummary}</p>
      </div>
    </div>
  );
}
