'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { InterviewDetail } from '../../../../../../lib/trpc-types';
import {
  averageRating,
  parseRecommendation,
  parseStoredRatings,
  withStoredCompetencies,
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
   * The competencies the scorecard rates now (the vacancy's job profile, or the generic set), in its order.
   * Each visible card is broken down by these PLUS the keys that card itself stored, so a rating given before
   * the profile changed (renamed or removed competency) still shows, as it does in the card's average.
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
    <section className="bg-surface rounded-lg p-3 mb-4" aria-labelledby="evaluator-comparison-title">
      <h4 id="evaluator-comparison-title" className="text-callout font-semibold text-brand mb-2">
        {t.interviews.evaluatorComparison}
      </h4>
      {evaluators.length === 0 ? (
        <p className="text-callout text-secondary">{t.interviewRoom.comparisonEmpty}</p>
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
              <li key={ev.id} className="text-callout">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-secondary truncate">
                    {ev.user.firstName} {ev.user.lastName} {isYou ? t.interviewRoom.comparisonYou : ''}
                  </span>
                  <span className="ml-auto text-right font-medium text-brand tabular-nums">
                    {!card
                      ? t.interviewRoom.comparisonPending
                      : showScore
                        ? `${avg !== null ? avg.toFixed(1) : '—'}${rec ? ` · ${t.interviewRoom[RECOMMENDATION_LABEL_KEYS[rec]]}` : ''}`
                        : t.interviewRoom.comparisonSubmitted}
                  </span>
                </div>
                {showScore && competencies.length > 0 && (
                  <details className="mt-1 pl-2">
                    <summary className="cursor-pointer rounded text-secondary hover:text-brand pointer-coarse:min-h-11">
                      {t.interviewRoom.comparisonDetails}
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {withStoredCompetencies(competencies, ratings).map((c) => {
                        const value = ratings[c.key];
                        return (
                          <li key={c.key} className="flex flex-wrap items-center gap-x-2">
                            <span className="text-secondary truncate">{labelFor(c)}</span>
                            <span className="ml-auto text-right text-brand">
                              {value === undefined
                                ? t.interviewRoom.comparisonNotRated
                                : t.interviewRoom.comparisonRating.replace('{n}', String(value))}
                              {c.targetLevel !== null && (
                                <span className="text-muted">
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
        <p className="text-callout text-secondary mt-2">{t.interviewRoom.comparisonHidden}</p>
      )}
    </section>
  );
}
