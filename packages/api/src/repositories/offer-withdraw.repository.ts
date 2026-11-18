import { tenantDb, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';

// Data access for offer.withdraw ("Retirar oferta", routers/offer/withdraw.ts). The rule (which statuses may
// be withdrawn, what the settings keep) lives in the router; this file only reads and writes.

export const OFFER_WITHDRAW_SELECT = {
  id: true,
  status: true,
  settings: true,
  updatedAt: true,
} satisfies Prisma.OfferSelect;

export type OfferForWithdraw = Prisma.OfferGetPayload<{ select: typeof OFFER_WITHDRAW_SELECT }>;

export const offerWithdrawRepository = {
  /** The offer, through the caller's scope (AND-composed), or null. */
  findForWithdraw(organizationId: string, offerId: string, scopeWhere: Prisma.OfferWhereInput) {
    return tenantDb.offer.findFirst({
      where: { AND: [{ id: offerId, organizationId }, scopeWhere] },
      select: OFFER_WITHDRAW_SELECT,
    });
  },

  /** "First Last" of the staff member withdrawing, for the offer history; '' when not found. */
  async actorName(organizationId: string, userId: string): Promise<string> {
    const actor = await tenantDb.user.findFirst({
      where: { id: userId, organizationId },
      select: { firstName: true, lastName: true },
    });
    return actor ? `${actor.firstName} ${actor.lastName}`.trim() : '';
  },

  /**
   * In one tenant transaction: compare-and-set the offer from the state that was read (status AND updatedAt)
   * to `withdrawn` with the given settings, cancel its still-pending approval steps and write the audit row.
   * Returns null when the compare-and-set matched nothing (a concurrent accept, approval or send won).
   */
  withdraw(
    organizationId: string,
    offer: Pick<OfferForWithdraw, 'id' | 'status' | 'updatedAt'>,
    settings: Prisma.InputJsonObject,
    audit: { userId: string; actorId: string },
  ) {
    return runTenantTransaction(organizationId, async (tx) => {
      const moved = await tx.offer.updateMany({
        where: { id: offer.id, organizationId, status: offer.status, updatedAt: offer.updatedAt },
        data: { status: 'withdrawn', settings },
      });
      if (moved.count !== 1) return null;

      const cancelled = await tx.offerApproval.updateMany({
        where: { organizationId, offerId: offer.id, status: 'pending' },
        data: { status: 'cancelled' },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId: audit.userId,
          actorId: audit.actorId,
          action: 'offer_withdrawn',
          entity: 'offer',
          entityId: offer.id,
          metadata: { previousStatus: offer.status, cancelledSteps: cancelled.count },
        },
      });

      return tx.offer.findFirstOrThrow({
        where: { id: offer.id, organizationId },
        select: { id: true, status: true, updatedAt: true },
      });
    });
  },
};
