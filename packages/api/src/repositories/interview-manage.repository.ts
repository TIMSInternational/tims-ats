import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { interviewStatusFilterWhere, OPEN_INTERVIEW_STATUSES } from './interview-status-filter';

export type InterviewKpiCounts = { scheduled: number; completed: number; cancelled: number };

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
   * "No se presentó" (A-02): one conditional write, so it cannot close an interview that has not started,
   * was already closed or completed, or has a submitted scorecard by the time the write runs. False when
   * nothing matched (nothing written).
   */
  async markNoShow(
    orgId: string,
    interviewId: string,
    now: Date,
    clearedJoinToken: Prisma.InterviewUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await db.interview.updateMany({
      where: {
        id: interviewId,
        organizationId: orgId,
        status: { in: [...OPEN_INTERVIEW_STATUSES] },
        scheduledAt: { lte: now },
        scorecards: { none: { submittedAt: { not: null } } },
      },
      data: { status: 'no_show', ...clearedJoinToken },
    });
    return count === 1;
  },
};
