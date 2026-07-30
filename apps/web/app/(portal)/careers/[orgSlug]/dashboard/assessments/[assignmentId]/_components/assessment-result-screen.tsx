'use client';

import { useI18n } from '../../../../../../../../lib/i18n';

interface AssessmentResultScreenProps {
  normalizedScore: number | null;
  hasPending: boolean;
}

export function AssessmentResultScreen({ normalizedScore, hasPending }: AssessmentResultScreenProps) {
  const { t } = useI18n();
  const roundedScore = normalizedScore !== null ? Math.round(normalizedScore) : null;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full text-center space-y-4">
        <h1 className="text-lg font-semibold text-[#1F114C]">{t.assessmentPlayer.resultTitle}</h1>
        {roundedScore !== null && (
          <p className="text-3xl font-bold text-[#1F114C]">
            {t.assessmentPlayer.resultScoreLabel} {roundedScore}%
          </p>
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
