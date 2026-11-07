'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { InterviewGuideResult } from '../../../../../../lib/trpc-types';

interface GuideCompetencyQuestionsProps {
  sets: InterviewGuideResult['competencyQuestions'];
}

/**
 * The AI interview guide's questions for each of the vacancy's competencies — the same set the scorecard
 * rates. Names and target levels come from the job profile (matched server-side), never from the model.
 */
export function GuideCompetencyQuestions({ sets }: GuideCompetencyQuestionsProps) {
  const { t } = useI18n();
  if (sets.length === 0) return null;

  return (
    <div className="pt-2 border-t border-[#EDEDED]">
      <p className="text-[12px] font-medium text-[#1F114C] mb-1">{t.interviews.guideCompetencyHeading}</p>
      <div className="space-y-2">
        {sets.map((set) => (
          <div key={set.competency}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium text-[#333]">{set.competency}</span>
              {set.targetLevel !== null && (
                <span className="text-[10px] text-[#8B8B8B] shrink-0">
                  {t.interviews.guideTargetLevel
                    .replace('{n}', String(set.targetLevel))
                    .replace('{max}', String(set.targetScaleMax))}
                </span>
              )}
            </div>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {set.questions.map((q, qi) => (
                <li key={qi} className="text-[11px] text-[#585858]">
                  {q}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
