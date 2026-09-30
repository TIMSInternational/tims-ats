import { tenantDb as db } from '@tims/db';

// ---------------------------------------------------------------------------
// Interview scorecard repository — the two facts the blind-evaluation rule
// needs about a viewer (see services/scorecard-visibility.service.ts).
// Both lookups are tenant-scoped on organizationId (defense in depth over RLS).
// ---------------------------------------------------------------------------

export const interviewScorecardRepository = {
  async getViewerPanelState(
    orgId: string,
    interviewId: string,
    userId: string,
  ): Promise<{ isEvaluator: boolean; hasSubmitted: boolean }> {
    const [evaluator, submitted] = await Promise.all([
      db.interviewEvaluator.findFirst({
        where: { interviewId, userId, interview: { organizationId: orgId } },
        select: { id: true },
      }),
      db.interviewScorecard.findFirst({
        where: { organizationId: orgId, interviewId, evaluatorId: userId, submittedAt: { not: null } },
        select: { id: true },
      }),
    ]);
    return { isEvaluator: evaluator !== null, hasSubmitted: submitted !== null };
  },
};
