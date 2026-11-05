import { tenantDb } from '@tims/db';
import type { Prisma } from '@tims/db';

// Data access for the hire guard (F-15): a vacancy's positions and its converted offers. The rule itself
// (isVacancyFilled) and the refusal live in services/hire-closure.service.ts.

export type VacancyHireCounts = { positions: number; hires: number };

function convertedWhere(organizationId: string, vacancyId: string) {
  return { vacancyId, organizationId, status: 'converted' } satisfies Prisma.OfferWhereInput;
}

export const vacancyHireRepository = {
  /** Without a lock, for the pre-check outside the hire transaction. Null when the vacancy is not in this org. */
  async counts(organizationId: string, vacancyId: string): Promise<VacancyHireCounts | null> {
    const vacancy = await tenantDb.vacancy.findFirst({
      where: { id: vacancyId, organizationId },
      select: { positions: true },
    });
    if (!vacancy) return null;
    const hires = await tenantDb.offer.count({ where: convertedWhere(organizationId, vacancyId) });
    return { positions: vacancy.positions, hires };
  },

  /**
   * Inside the hire transaction: locks the vacancy row FOR NO KEY UPDATE (the mode closeHireRecords takes again
   * later in the same transaction), then counts its converted offers. Null when the vacancy is not in this org.
   */
  async lockAndCount(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vacancyId: string,
  ): Promise<VacancyHireCounts | null> {
    const locked = await tx.$queryRaw<Array<{ positions: number }>>`
      SELECT positions FROM vacancies
      WHERE id = ${vacancyId}::uuid AND organization_id = ${organizationId}::uuid
      FOR NO KEY UPDATE`;
    const vacancy = locked[0];
    if (!vacancy) return null;
    const hires = await tx.offer.count({ where: convertedWhere(organizationId, vacancyId) });
    return { positions: vacancy.positions, hires };
  },
};
