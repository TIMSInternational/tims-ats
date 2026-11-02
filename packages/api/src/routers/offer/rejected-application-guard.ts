import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';

// A candidate rejected in the pipeline must not be able to accept an outstanding offer for that vacancy, and
// such an offer must not be sent or converted to a hire. Rejecting the application does not touch the offer
// (there is no withdrawn offer state), so every offer transition that matters re-checks the application here.
//
// The offer's linked application decides. An offer created without the link falls back to the candidate's
// applications for the vacancy: refused when at least one exists and every one of them is rejected.
// `client` is the caller's client (pass a tx to run inside that transaction).
export interface RejectedApplicationClient {
  offer: {
    findFirst(args: {
      where: Prisma.OfferWhereInput;
      select: { applicationId: true; candidateId: true; vacancyId: true };
    }): Promise<{ applicationId: string | null; candidateId: string; vacancyId: string } | null>;
  };
  application: {
    findMany(args: {
      where: Prisma.ApplicationWhereInput;
      select: { status: true };
    }): Promise<Array<{ status: string }>>;
  };
}

/**
 * Offer-write predicate, evaluated in the same SQL statement as the write it guards:
 * - a linked offer passes only while its application is not rejected;
 * - an unlinked offer passes while the candidate has no application for the vacancy, or at least one that
 *   is not rejected (the same rule as `assertApplicationNotRejected`).
 */
export function notRejectedApplication(vacancyId: string) {
  return {
    OR: [
      { applicationId: { not: null }, application: { status: { not: 'rejected' } } },
      { applicationId: null, candidate: { applications: { none: { vacancyId } } } },
      { applicationId: null, candidate: { applications: { some: { vacancyId, status: { not: 'rejected' } } } } },
    ],
  } satisfies Prisma.OfferWhereInput;
}

export async function assertApplicationNotRejected(
  client: RejectedApplicationClient,
  organizationId: string,
  offerId: string,
  message: string,
) {
  const offer = await client.offer.findFirst({
    where: { id: offerId, organizationId },
    select: { applicationId: true, candidateId: true, vacancyId: true },
  });
  if (!offer) return;
  const applications = await client.application.findMany({
    where: offer.applicationId
      ? { id: offer.applicationId, organizationId }
      : { organizationId, candidateId: offer.candidateId, vacancyId: offer.vacancyId },
    select: { status: true },
  });
  if (applications.length > 0 && applications.every((application) => application.status === 'rejected')) {
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  }
}
