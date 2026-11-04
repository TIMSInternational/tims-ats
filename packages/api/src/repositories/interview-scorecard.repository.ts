import { tenantDb as db, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';

/** Interview statuses that refuse scorecard submission (#327). */
export const SCORECARD_CLOSED_STATUSES: readonly string[] = ['cancelled', 'no_show'];

/** Statuses a submitted scorecard moves to `completed` (once the interview has started). */
export const SCORECARD_COMPLETES_STATUSES: readonly string[] = ['scheduled', 'rescheduled', 'confirmed', 'in_progress'];

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
    return { status: interview.status, competencies: await interviewScorecardRepository.getCompetencies(orgId, interview.vacancyId) };
  },

  /**
   * The vacancy job profile's competencies (raw Json), or null without a profile — the set the room
   * rates and submit() requires. Read through the INTERVIEW by its callers, so a panelist with no
   * vacancy:read gets it too.
   */
  async getCompetencies(orgId: string, vacancyId: string): Promise<Prisma.JsonValue | null> {
    const profile = await db.jobProfile.findFirst({
      where: { vacancyId, organizationId: orgId },
      select: { competencies: true },
    });
    return profile?.competencies ?? null;
  },

  /**
   * Upsert the caller's scorecard as submitted. A RE-submission (their card was
   * already submitted — so the other evaluators' cards were already visible to
   * them) also writes an audit_logs row carrying the previous values, in the same
   * transaction: an evaluator who revises after reading the panel is detectable.
   *
   * Returns null, writing nothing, when the interview is closed (cancelled /
   * no_show) at write time. The service already checked the status, but a cancel
   * can land between that read and this transaction; re-checking here narrows that
   * window to the transaction itself (#332 panel, L1).
   *
   * A submitted scorecard is proof the interview took place: when it has started
   * (scheduledAt <= now) and is still scheduled/rescheduled, it becomes
   * `completed` in the same transaction, so lists and KPIs stop calling a past
   * interview "Programada" (B-30). A card filed before the start changes nothing.
   * A video interview completes only once its scheduled END has passed: the
   * candidate's join link (C# CandidateInterviewJoin) refuses a completed
   * interview, so completing it mid-call would block a rejoin.
   */
  async submit(
    orgId: string,
    interviewId: string,
    evaluatorId: string,
    actorId: string,
    data: ScorecardSubmissionData,
  ) {
    return runTenantTransaction(orgId, async (tx) => {
      const open = await tx.interview.findFirst({
        where: { id: interviewId, organizationId: orgId, status: { notIn: [...SCORECARD_CLOSED_STATUSES] } },
        select: { id: true, type: true, scheduledAt: true, duration: true },
      });
      if (!open) return null;
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
      const callStillOpen =
        open.type === 'video' &&
        open.scheduledAt instanceof Date &&
        open.scheduledAt.getTime() + (open.duration ?? 0) * 60_000 > submittedAt.getTime();
      if (!callStillOpen) {
        // Status-guarded: a cancel that landed meanwhile is never overwritten.
        await tx.interview.updateMany({
          where: {
            id: interviewId,
            organizationId: orgId,
            status: { in: [...SCORECARD_COMPLETES_STATUSES] },
            scheduledAt: { lte: submittedAt },
          },
          data: { status: 'completed' },
        });
      }
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
