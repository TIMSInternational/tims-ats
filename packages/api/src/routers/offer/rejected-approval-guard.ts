import { TRPCError } from '@trpc/server';
import { offerApprovalRepository, type OfferApprovalCountClient } from '../../repositories/offer-approval.repository';

// Offers enter an approval chain only from draft and never return to draft, so ANY rejected
// approval row means the offer was rejected. Before approve/reject were state-guarded, the last
// remaining approver could move a rejected offer to `approved`; this refusal keeps such an offer
// (and any future regression) from being emailed, accepted, declined or converted to a hire.
// `client` is the caller's client (pass a tx to run inside that transaction).
export async function assertNoRejectedApproval(
  client: OfferApprovalCountClient,
  organizationId: string,
  offerId: string,
  message: string,
) {
  const rejected = await offerApprovalRepository.countRejected(client, organizationId, offerId);
  if (rejected > 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  }
}
