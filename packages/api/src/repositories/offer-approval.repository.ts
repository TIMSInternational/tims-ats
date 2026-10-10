import type { Prisma } from '@tims/db';

/**
 * Minimal client surface: the caller passes its own client - a `runTenantTransaction` tx so the
 * read joins that transaction, or the tenant client for a standalone precondition check.
 */
export interface OfferApprovalCountClient {
  offerApproval: { count(args: { where: Prisma.OfferApprovalWhereInput }): Promise<number> };
}

export const offerApprovalRepository = {
  /** Rejected approval rows on one offer, always scoped to the caller's organization. */
  countRejected(client: OfferApprovalCountClient, organizationId: string, offerId: string): Promise<number> {
    return client.offerApproval.count({
      where: { offerId, organizationId, status: 'rejected' },
    });
  },
};
