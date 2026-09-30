import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { interviewScorecardRepository } from '../repositories/interview-scorecard.repository';

// ---------------------------------------------------------------------------
// BLIND EVALUATION — server-enforced scorecard visibility (PR #303, codex r3 P1).
//
// The interview room tells a panel evaluator that the other evaluators' scores
// stay hidden until they submit their own (it prevents anchoring). Hiding them
// in the UI alone is not a control: the payload is one DevTools tab away. This
// module is the server-side rule every scorecard read path applies.
//
// THE RULE
//   A viewer is BLINDED when they are on the interview's panel (an
//   InterviewEvaluator row exists for them) AND they have NOT submitted their
//   own scorecard (no row of theirs with submittedAt set). A blinded viewer:
//     - sees their OWN scorecard in full;
//     - sees every OTHER evaluator's scorecard only as a status stub (who, and
//       whether/when they submitted) — ratings `{}`, recommendation `''`,
//       overallNotes `null`, biasFlags `null`, `isWithheld: true`;
//     - does not receive the persisted AI summary (it is derived from the
//       other scorecards);
//     - is refused (FORBIDDEN) on every AGGREGATE or DERIVED view of the
//       scorecards: compareEvaluators, the AI summary, the AI bias check.
//   Once they submit, they are no longer blinded and see everything their
//   interview:read permission + scope already grant.
//
//   A viewer who is NOT on the panel (a recruiter / hiring manager / HR admin
//   holding interview:read within scope) is never blinded. They submit nothing
//   (submitScorecard is panel-only), so there is nothing to anchor, and they are
//   the intended consumers of the debrief — this is exactly what interview:read
//   granted them before this rule existed, so it stays the least surprising.
//
// Known limits (deliberate, documented): an evaluator removed from the panel
// before submitting stops being blinded (removal needs interview:update); and a
// submitted evaluator can still UPDATE their scorecard after seeing the others
// (the rule protects the first independent read, not re-submission).
// ---------------------------------------------------------------------------

export interface WithholdableScorecard {
  evaluatorId: string;
  submittedAt: Date | null;
}

/** The persisted content fields the rule withholds (shape of an InterviewScorecard row). */
export interface ScorecardContent extends WithholdableScorecard {
  ratings: Prisma.JsonValue;
  recommendation: string;
  overallNotes: string | null;
  biasFlags: Prisma.JsonValue | null;
}

export type VisibleScorecard<T extends ScorecardContent> = T & { isWithheld: boolean };

/** Pure: is this viewer blinded, given the panel and the scorecards already loaded? */
export function isBlindedViewer(
  viewerId: string,
  panelUserIds: readonly string[],
  scorecards: readonly WithholdableScorecard[],
): boolean {
  if (!panelUserIds.includes(viewerId)) return false;
  return !scorecards.some((s) => s.evaluatorId === viewerId && s.submittedAt !== null);
}

/**
 * Pure: apply the rule to one scorecard for a viewer whose blinded state is known.
 * Someone else's card, seen by a blinded viewer, keeps only who/when (status stub).
 */
export function visibleScorecard<T extends ScorecardContent>(
  sc: T,
  viewerId: string,
  blinded: boolean,
): VisibleScorecard<T> {
  if (blinded && sc.evaluatorId !== viewerId) {
    return { ...sc, ratings: {}, recommendation: '', overallNotes: null, biasFlags: null, isWithheld: true };
  }
  return { ...sc, isWithheld: false };
}

export const scorecardVisibilityService = {
  /** DB-backed blinded check for paths that have not loaded the panel themselves. */
  async isBlinded(orgId: string, interviewId: string, viewerId: string): Promise<boolean> {
    const state = await interviewScorecardRepository.getViewerPanelState(orgId, interviewId, viewerId);
    return state.isEvaluator && !state.hasSubmitted;
  },

  /** Guard for aggregate / derived scorecard views (compare, AI summary, AI bias). */
  async assertNotBlinded(orgId: string, interviewId: string, viewerId: string): Promise<void> {
    if (await this.isBlinded(orgId, interviewId, viewerId)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Envia tu evaluacion antes de ver las evaluaciones de los demas evaluadores',
      });
    }
  },
};
