import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';

// Offers enter an approval chain only from draft and never return to draft, so ANY rejected
// approval row means the offer was rejected. Before approve/reject were state-guarded, the last
// remaining approver could move a rejected offer to `approved`; this refusal keeps such an offer
// (and any future regression) from being emailed, accepted, declined or converted to a hire.
export async function assertNoRejectedApproval(offerId: string, organizationId: string, message: string) {
  const rejected = await db.offerApproval.count({
    where: { offerId, organizationId, status: 'rejected' },
  });
  if (rejected > 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  }
}
