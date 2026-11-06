'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { InterviewDetail } from '../../../../../../lib/trpc-types';
import {
  averageRating,
  parseRecommendation,
  parseStoredRatings,
  type ScorecardCompetency,
} from './scorecard-model';
import { RECOMMENDATION_LABEL_KEYS } from './recommendation-picker';

interface EvaluatorComparisonProps {
  evaluators: InterviewDetail['evaluators'];
  scorecards: InterviewDetail['scorecards'];
  currentUserId: string | null;
  /**
   * The viewer is a panel evaluator who has not submitted yet. Drives ONLY the explanatory
   * hint: whether a score renders is decided per card by the server's `isWithheld`.
   */
  isViewerBlinded: boolean;
  /**
   * The competencies the scorecard form rates, in its order and with its labels (the vacancy's job profile,
   * or the generic set), so each visible card is broken down exactly as it was filled in.
   */
  competencies?: ScorecardCompetency[];
  labelFor?: (c: ScorecardCompetency) => string;
}

/** Real per-evaluator status from the interview's persisted scorecards. */
export function EvaluatorComparison({
  evaluators,
  scorecards,
  currentUserId,
  isViewerBlinded,
  competencies = [],
  labelFor = (c) => c.label ?? c.key,
}: EvaluatorComparisonProps) {
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
            const ratings = card ? parseStoredRatings(card.ratings) : {};
            const avg = card ? averageRating(ratings) : null;
            const rec = card ? parseRecommendation(card.recommendation) : null;
            // Blind evaluation is decided by the SERVER (services/scorecard-visibility.service.ts):
            // it sends a blinded panel evaluator status stubs (isWithheld) and everyone else the
            // real cards. So: show every card that was not withheld — that is what lets non-panel
            // staff (recruiter / HR with interview:read) see the debrief — and never render a stub
            // as a score, e.g. in the window between submitting and the getById refetch.
            const showScore = card !== undefined && !card.isWithheld;
            return (
              <li key={ev.id} className="text-[10px]">
                <div className="flex items-center gap-2">
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
                </div>
                {showScore && competencies.length > 0 && (
                  <details className="mt-1 pl-2">
                    <summary className="cursor-pointer text-[#8B8B8B] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C] rounded">
                      {t.interviewRoom.comparisonDetails}
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {competencies.map((c) => {
                        const value = ratings[c.key];
                        return (
                          <li key={c.key} className="flex items-center gap-2">
                            <span className="text-[#585858] truncate">{labelFor(c)}</span>
                            <span className="ml-auto text-right text-[#1F114C]">
                              {value === undefined
                                ? t.interviewRoom.comparisonNotRated
                                : t.interviewRoom.comparisonRating.replace('{n}', String(value))}
                              {c.targetLevel !== null && (
                                <span className="text-[#8B8B8B]">
                                  {' · '}
                                  {t.interviewRoom.targetLevel
                                    .replace('{n}', String(c.targetLevel))
                                    .replace('{max}', String(c.targetScaleMax))}
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {isViewerBlinded && evaluators.length > 1 && (
        <p className="text-[10px] text-[#8B8B8B] mt-2">{t.interviewRoom.comparisonHidden}</p>
      )}
    </section>
  );
}
