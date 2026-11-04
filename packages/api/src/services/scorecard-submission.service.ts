import { ratingsCoverCompetencySet } from '@tims/shared';
import { candidateJoinApplies, joinTokenExpiry } from './interview-join-token';
import {
  interviewScorecardRepository,
  SCORECARD_CLOSED_STATUSES,
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
//     must keep working once the interview is marked completed. Checked here
//     (fast refusal) and again inside the write transaction (the repository
//     returns null if a cancel landed in between).
//   - A SUBMITTED CARD COMPLETES A STARTED INTERVIEW (B-30): a past interview no
//     longer stays "Programada" forever. Exception: while the candidate's own
//     video join link is still valid (scheduled end + JOIN_TOKEN_GRACE_MINUTES —
//     the window the C# join honours for overruns) the interview stays open, since
//     the join refuses a completed interview and would block a rejoin. The list
//     shows such a scored-but-open interview as completed (submitted-card count).
// ---------------------------------------------------------------------------

/** Whether a card submitted at `now` should mark the interview completed. */
export function shouldCompleteOnScorecard(
  interview: { id: string; type: string; meetingUrl: string | null; scheduledAt: Date; duration: number },
  now: Date = new Date(),
): boolean {
  if (interview.scheduledAt.getTime() > now.getTime()) return false;
  const joinStillValid =
    candidateJoinApplies(interview.type, { meetingUrl: interview.meetingUrl, interviewId: interview.id }) &&
    now.getTime() < joinTokenExpiry(interview.scheduledAt, interview.duration).getTime();
  return !joinStillValid;
}

export type SubmitScorecardResult =
  | { ok: true; scorecard: NonNullable<Awaited<ReturnType<typeof interviewScorecardRepository.submit>>> }
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
    // The write re-checks the schedule this decision was made on (a concurrent reschedule wins).
    const completeIfUnchanged = shouldCompleteOnScorecard({ id: interviewId, ...context })
      ? { scheduledAt: context.scheduledAt, duration: context.duration, meetingUrl: context.meetingUrl ?? null }
      : undefined;
    const scorecard = await interviewScorecardRepository.submit(orgId, interviewId, evaluatorId, actorId, data, {
      completeIfUnchanged,
    });
    if (!scorecard) return { ok: false, reason: 'closed' };
    return { ok: true, scorecard };
  },
};
