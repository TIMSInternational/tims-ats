import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';

// Reads the interview-management rule needs (services/interview-management.service.ts). Tenant-scoped on
// organizationId; selects only the id.
export const interviewManageRepository = {
  /** True when the interview is in this org AND its (not soft-deleted) vacancy matches `vacancyWhere`. */
  async existsOnVacancy(orgId: string, interviewId: string, vacancyWhere: Prisma.VacancyWhereInput): Promise<boolean> {
    const row = await db.interview.findFirst({
      where: {
        AND: [{ id: interviewId }, { organizationId: orgId }, { vacancy: { AND: [vacancyWhere, { deletedAt: null }] } }],
      },
      select: { id: true },
    });
    return row !== null;
  },
};
