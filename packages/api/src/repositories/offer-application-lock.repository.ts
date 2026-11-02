import { runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';

export type OfferApplicationRef = { applicationId: string | null; candidateId: string; vacancyId: string };

// Data access for serializing an offer write (send / accept) with a concurrent rejection of the candidate's
// application. The rule itself lives in routers/offer/rejected-application-guard.ts.
export const offerApplicationLockRepository = {
  /** Runs `fn` in one tenant transaction (the lock below must share it with the offer write). */
  inTransaction<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return runTenantTransaction(organizationId, fn);
  },

  /**
   * Locks the candidate's application row(s) for this offer FOR SHARE and returns their statuses: the linked
   * application, or — for an offer without the link — the candidate's applications for the vacancy.
   */
  async lockStatuses(
    tx: Prisma.TransactionClient,
    organizationId: string,
    offer: OfferApplicationRef,
  ): Promise<string[]> {
    const rows = offer.applicationId
      ? await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM applications
          WHERE id = ${offer.applicationId}::uuid AND organization_id = ${organizationId}::uuid
          FOR SHARE`
      : await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM applications
          WHERE organization_id = ${organizationId}::uuid
            AND candidate_id = ${offer.candidateId}::uuid
            AND vacancy_id = ${offer.vacancyId}::uuid
          FOR SHARE`;
    return rows.map((row) => row.status);
  },
};
