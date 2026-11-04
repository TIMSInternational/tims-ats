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
  ): Promise<
    | {
        status: string;
        type: string;
        meetingUrl: string | null;
        scheduledAt: Date;
        duration: number;
        competencies: Prisma.JsonValue | null;
      }
    | undefined
  > {
    const interview = await db.interview.findFirst({
      where: { id: interviewId, organizationId: orgId },
      select: { vacancyId: true, status: true, type: true, meetingUrl: true, scheduledAt: true, duration: true },
    });
    if (!interview) return undefined;
    const { vacancyId, ...facts } = interview;
    return { ...facts, competencies: await interviewScorecardRepository.getCompetencies(orgId, vacancyId) };
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
   * With `completeIfUnchanged` (decided by scorecard-submission.service.ts from
   * the schedule it read) a still scheduled/rescheduled interview becomes
   * `completed` in the same transaction — only if its status, start, duration and
   * meeting link are still the ones the decision was made on, so neither a cancel
   * nor a reschedule that landed meanwhile is overwritten (B-30).
   */
  async submit(
    orgId: string,
    interviewId: string,
    evaluatorId: string,
    actorId: string,
    data: ScorecardSubmissionData,
    options: { completeIfUnchanged?: { scheduledAt: Date; duration: number; meetingUrl: string | null } } = {},
  ) {
    return runTenantTransaction(orgId, async (tx) => {
      const open = await tx.interview.findFirst({
        where: { id: interviewId, organizationId: orgId, status: { notIn: [...SCORECARD_CLOSED_STATUSES] } },
        select: { id: true },
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
      const read = options.completeIfUnchanged;
      if (read) {
        await tx.interview.updateMany({
          where: {
            id: interviewId,
            organizationId: orgId,
            status: { in: [...SCORECARD_COMPLETES_STATUSES] },
            scheduledAt: read.scheduledAt,
            duration: read.duration,
            meetingUrl: read.meetingUrl,
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
