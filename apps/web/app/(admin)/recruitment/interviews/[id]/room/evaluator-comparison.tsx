'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { InterviewDetail } from '../../../../../../lib/trpc-types';
import { averageRating, parseRecommendation, parseStoredRatings } from './scorecard-model';
import { RECOMMENDATION_LABEL_KEYS } from './recommendation-picker';

interface EvaluatorComparisonProps {
  evaluators: InterviewDetail['evaluators'];
  scorecards: InterviewDetail['scorecards'];
  currentUserId: string | null;
  /** Other evaluators' scores stay hidden until the viewer has submitted (avoids anchoring). */
  revealScores: boolean;
}

/** Real per-evaluator status from the interview's persisted scorecards. */
export function EvaluatorComparison({ evaluators, scorecards, currentUserId, revealScores }: EvaluatorComparisonProps) {
  const { t } = useI18n();

  return (
    <section className="bg-[#F6F6F6] rounded-lg p-3 mb-4" aria-labelledby="evaluator-comparison-title">
      <p id="evaluator-comparison-title" className="text-[11px] font-medium text-[#1F114C] mb-2">
        {t.interviews.evaluatorComparison}
      </p>
      {evaluators.length === 0 ? (
        <p className="text-[10px] text-[#8B8B8B]">{t.interviewRoom.comparisonEmpty}</p>
      ) : (
        <ul className="space-y-1.5">
          {evaluators.map((ev) => {
            const isYou = ev.userId === currentUserId;
            const card = scorecards.find((s) => s.evaluatorId === ev.userId && s.submittedAt !== null);
            const avg = card ? averageRating(parseStoredRatings(card.ratings)) : null;
            const rec = card ? parseRecommendation(card.recommendation) : null;
            const showScore = card !== undefined && (isYou || revealScores);
            return (
              <li key={ev.id} className="flex items-center gap-2 text-[10px]">
                <span className="text-[#585858] truncate">
                  {ev.user.firstName} {ev.user.lastName} {isYou ? t.interviewRoom.comparisonYou : ''}
                </span>
                <span className="ml-auto text-right font-medium text-[#1F114C]">
                  {!card
                    ? t.interviewRoom.comparisonPending
                    : showScore
                      ? `${avg !== null ? avg.toFixed(1) : '—'}${rec ? ` · ${t.interviewRoom[RECOMMENDATION_LABEL_KEYS[rec]]}` : ''}`
                      : t.interviewRoom.comparisonSubmitted}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!revealScores && evaluators.length > 1 && (
        <p className="text-[10px] text-[#8B8B8B] mt-2">{t.interviewRoom.comparisonHidden}</p>
      )}
    </section>
  );
}
