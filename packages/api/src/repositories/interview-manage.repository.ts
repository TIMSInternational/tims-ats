import { tenantDb as db, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { interviewStatusFilterWhere, OPEN_INTERVIEW_STATUSES } from './interview-status-filter';

export type InterviewKpiCounts = { scheduled: number; completed: number; cancelled: number };

// No-show and reschedule SERIALIZE WITH SCORECARD SUBMISSION through the interview row lock (#405 review):
// each opens its transaction with the write to the interview row (Postgres holds that lock to commit), and
// only THEN counts submitted scorecards, in a new statement — one that sees a card committed by a
// submission which held the lock first (a condition inside the UPDATE would read the statement's older
// snapshot). A submission takes the same lock first (interview-scorecard.repository.ts submit).

/** Thrown inside the transaction to roll the write back when a submitted scorecard exists. */
class SubmittedScorecardExists extends Error {}

function countSubmittedCards(tx: Prisma.TransactionClient, orgId: string, interviewId: string): Promise<number> {
  return tx.interviewScorecard.count({ where: { organizationId: orgId, interviewId, submittedAt: { not: null } } });
}

export type RescheduleResult =
  | { ok: true; interview: NonNullable<Awaited<ReturnType<typeof findRescheduled>>> }
  | { ok: false; reason: 'closed' | 'scored' };

function findRescheduled(tx: Prisma.TransactionClient, orgId: string, interviewId: string) {
  return tx.interview.findFirst({
    where: { id: interviewId, organizationId: orgId },
    omit: { candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true },
    include: {
      candidate: { select: { firstName: true, lastName: true, email: true } },
      vacancy: { select: { title: true } },
    },
  });
}

// Reads and writes the interview-management rules need (services/interview-management.service.ts,
// routers/interview/crud.ts). Tenant-scoped on organizationId; selects only what is used.
export const interviewManageRepository = {
  /** True when the interview is in this org AND its (not soft-deleted) vacancy matches `vacancyWhere`. */
  async existsOnVacancy(orgId: string, interviewId: string, vacancyWhere: Prisma.VacancyWhereInput): Promise<boolean> {
    const row = await db.interview.findFirst({
      where: {
        AND: [
          { id: interviewId },
          { organizationId: orgId },
          { vacancy: { AND: [vacancyWhere, { deletedAt: null }] } },
        ],
      },
      select: { id: true },
    });
    return row !== null;
  },

  /**
   * The interviews page's KPI cards, counted under `base` (tenant + scope + the caller's non-date filters)
   * with the same badge rule as the status filter, across all dates (A-02 / B-30).
   */
  async countKpis(base: Prisma.InterviewWhereInput[], now: Date): Promise<InterviewKpiCounts> {
    const countFor = (status: string) =>
      db.interview.count({ where: { AND: [...base, interviewStatusFilterWhere(status, now)] } });
    const [scheduled, completed, cancelled] = await Promise.all([
      countFor('scheduled'),
      countFor('completed'),
      countFor('cancelled'),
    ]);
    return { scheduled, completed, cancelled };
  },

  /**
   * "No se presentó" (A-02): closes an open interview that has started and has no submitted scorecard.
   * False — nothing written — when it had not started, was already closed / completed, or a card exists.
   */
  async markNoShow(
    orgId: string,
    interviewId: string,
    now: Date,
    clearedJoinToken: Prisma.InterviewUpdateManyMutationInput,
  ): Promise<boolean> {
    try {
      return await runTenantTransaction(orgId, async (tx) => {
        const { count } = await tx.interview.updateMany({
          where: {
            id: interviewId,
            organizationId: orgId,
            status: { in: [...OPEN_INTERVIEW_STATUSES] },
            scheduledAt: { lte: now },
          },
          data: { status: 'no_show', ...clearedJoinToken },
        });
        if (count !== 1) return false;
        if ((await countSubmittedCards(tx, orgId, interviewId)) > 0) throw new SubmittedScorecardExists();
        return true;
      });
    } catch (err) {
      if (err instanceof SubmittedScorecardExists) return false;
      throw err;
    }
  },

  /**
   * Reschedule under the same lock. Refused — nothing written — when the interview was cancelled or
   * completed meanwhile (`closed`), or has a submitted scorecard (`scored`): a card belongs to the
   * appointment it was filed on, and would otherwise show the new one as completed the moment it starts.
   */
  async rescheduleUnscored(
    orgId: string,
    interviewId: string,
    data: Prisma.InterviewUpdateManyMutationInput,
  ): Promise<RescheduleResult> {
    try {
      return await runTenantTransaction(orgId, async (tx): Promise<RescheduleResult> => {
        const { count } = await tx.interview.updateMany({
          where: { id: interviewId, organizationId: orgId, status: { notIn: ['cancelled', 'completed'] } },
          data,
        });
        if (count !== 1) return { ok: false, reason: 'closed' };
        if ((await countSubmittedCards(tx, orgId, interviewId)) > 0) throw new SubmittedScorecardExists();
        const interview = await findRescheduled(tx, orgId, interviewId);
        return interview ? { ok: true, interview } : { ok: false, reason: 'closed' };
      });
    } catch (err) {
      if (err instanceof SubmittedScorecardExists) return { ok: false, reason: 'scored' };
      throw err;
    }
  },
};
