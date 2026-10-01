import { ratingsCoverCompetencySet } from '@tims/shared';
import {
  interviewScorecardRepository,
  type ScorecardSubmissionData,
} from '../repositories/interview-scorecard.repository';

// ---------------------------------------------------------------------------
// SCORECARD SUBMISSION — the server half of the blind-evaluation rule
// (see scorecard-visibility.service.ts). Submitting is what un-blinds an
// evaluator, so the server — not just the room UI — decides what counts as a
// submitted scorecard:
//
//   - COMPLETE: `ratings` must rate every competency the room derives for this
//     interview (the vacancy job profile's competencies, or the generic fallback
//     set — @tims/shared ratingsCoverCompetencySet, the SAME derivation the room
//     uses). Values 1..5, a recommendation and a bounded key count are enforced
//     by the router's Zod input. A placeholder `ratings: {}` card is refused, so
//     it can no longer be used to peek at the panel.
//   - RE-SUBMISSION IS ALLOWED, AND AUDITED: the room deliberately offers
//     "Update scorecard" after submit, so edits stay a product feature. Every
//     re-submission writes an audit_logs row (`interview_scorecard_resubmitted`)
//     with the previous ratings/recommendation and how many other evaluators had
//     submitted by then — revising after reading the panel is detectable, not
//     prevented.
//   - CLOSED INTERVIEWS REFUSE CARDS (#327): `cancelled` and `no_show` never
//     took place, so there is nothing to score. `completed` stays OPEN — scoring
//     after the interview ends is the normal flow, and the room's "Update" edit
//     must keep working once the interview is marked completed.
// ---------------------------------------------------------------------------

/** Interview statuses that refuse scorecard submission (#327). */
export const SCORECARD_CLOSED_STATUSES: readonly string[] = ['cancelled', 'no_show'];

export type SubmitScorecardResult =
  | { ok: true; scorecard: Awaited<ReturnType<typeof interviewScorecardRepository.submit>> }
  | { ok: false; reason: 'not_found' | 'incomplete' | 'closed' };

export const scorecardSubmissionService = {
  async submit(
    orgId: string,
    interviewId: string,
    evaluatorId: string,
    actorId: string,
    data: ScorecardSubmissionData,
  ): Promise<SubmitScorecardResult> {
    const context = await interviewScorecardRepository.getSubmissionContext(orgId, interviewId);
    if (context === undefined) return { ok: false, reason: 'not_found' };
    if (SCORECARD_CLOSED_STATUSES.includes(context.status)) return { ok: false, reason: 'closed' };
    if (!ratingsCoverCompetencySet(data.ratings, context.competencies)) return { ok: false, reason: 'incomplete' };
    const scorecard = await interviewScorecardRepository.submit(orgId, interviewId, evaluatorId, actorId, data);
    return { ok: true, scorecard };
  },
};
