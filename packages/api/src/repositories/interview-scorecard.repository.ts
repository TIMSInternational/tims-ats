import { tenantDb as db, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';

export interface ScorecardSubmissionData {
  ratings: Record<string, number>;
  recommendation: string;
  overallNotes?: string;
}

// ---------------------------------------------------------------------------
// Interview scorecard repository — the facts the blind-evaluation rule needs
// about a viewer (see services/scorecard-visibility.service.ts), plus the
// submission write (see services/scorecard-submission.service.ts).
// Every lookup is tenant-scoped on organizationId (defense in depth over RLS).
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

  /**
   * What a submission needs to know about the interview: its status (a closed
   * interview refuses scorecards) and its job-profile competencies (raw Json, or
   * null when the vacancy has no job profile). `undefined` when the interview is
   * not in this org.
   */
  async getSubmissionContext(
    orgId: string,
    interviewId: string,
  ): Promise<{ status: string; competencies: Prisma.JsonValue | null } | undefined> {
    const interview = await db.interview.findFirst({
      where: { id: interviewId, organizationId: orgId },
      select: { vacancyId: true, status: true },
    });
    if (!interview) return undefined;
    const profile = await db.jobProfile.findFirst({
      where: { vacancyId: interview.vacancyId, organizationId: orgId },
      select: { competencies: true },
    });
    return { status: interview.status, competencies: profile?.competencies ?? null };
  },

  /**
   * Upsert the caller's scorecard as submitted. A RE-submission (their card was
   * already submitted — so the other evaluators' cards were already visible to
   * them) also writes an audit_logs row carrying the previous values, in the same
   * transaction: an evaluator who revises after reading the panel is detectable.
   */
  async submit(
    orgId: string,
    interviewId: string,
    evaluatorId: string,
    actorId: string,
    data: ScorecardSubmissionData,
  ) {
    return runTenantTransaction(orgId, async (tx) => {
      const previous = await tx.interviewScorecard.findFirst({
        where: { organizationId: orgId, interviewId, evaluatorId },
        select: { id: true, ratings: true, recommendation: true, submittedAt: true },
      });
      const submittedAt = new Date();
      const saved = await tx.interviewScorecard.upsert({
        where: { interviewId_evaluatorId: { interviewId, evaluatorId } },
        create: { organizationId: orgId, interviewId, evaluatorId, ...data, submittedAt },
        update: { ...data, submittedAt },
      });
      if (previous?.submittedAt) {
        const othersSubmitted = await tx.interviewScorecard.count({
          where: { organizationId: orgId, interviewId, evaluatorId: { not: evaluatorId }, submittedAt: { not: null } },
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            userId: evaluatorId,
            actorId,
            action: 'interview_scorecard_resubmitted',
            entity: 'interview_scorecard',
            entityId: saved.id,
            changes: {
              before: { ratings: previous.ratings, recommendation: previous.recommendation },
              after: { ratings: data.ratings, recommendation: data.recommendation },
            } as Prisma.InputJsonValue,
            metadata: {
              interviewId,
              previousSubmittedAt: previous.submittedAt.toISOString(),
              otherSubmittedScorecards: othersSubmitted,
            },
          },
        });
      }
      return saved;
    });
  },
};
