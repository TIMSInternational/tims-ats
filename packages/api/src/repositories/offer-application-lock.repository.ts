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

  /**
   * Serializes offer creation per candidate (one open offer per candidate and vacancy): locks the candidate
   * row FOR NO KEY UPDATE inside the caller's transaction. A concurrent create for the same candidate waits
   * here until the first commits, and its open-offer check (a new statement) then sees the first offer.
   * NO KEY UPDATE, not UPDATE: the offer insert's foreign key takes KEY SHARE on the same row, which this
   * mode does not block. Returns false when the candidate is not in this organization.
   */
  async lockCandidate(tx: Prisma.TransactionClient, organizationId: string, candidateId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM candidates
      WHERE id = ${candidateId}::uuid AND organization_id = ${organizationId}::uuid
      FOR NO KEY UPDATE`;
    return rows.length === 1;
  },
};
