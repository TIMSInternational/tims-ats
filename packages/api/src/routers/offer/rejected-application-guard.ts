import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import {
  offerApplicationLockRepository,
  type OfferApplicationRef,
} from '../../repositories/offer-application-lock.repository';

// A candidate rejected in the pipeline must not be able to accept an outstanding offer for that vacancy, and
// such an offer must not be sent or converted to a hire. Rejecting the application does not touch the offer
// (there is no withdrawn offer state), so every offer transition that matters re-checks the application here.
// A candidate who WITHDREW the application ("Retirar mi postulación", C-33) is closed the same way: without
// it, staff could still send, have accepted and convert an offer for a withdrawn application.
//
// The offer's linked application decides. An offer created without the link falls back to the candidate's
// applications for the vacancy: refused when at least one exists and every one of them is closed.
// `client` is the caller's client (pass a tx to run inside that transaction).

/** Application statuses that end the process for the candidate: no offer may move forward on them. */
export const CLOSED_APPLICATION_STATUSES = ['rejected', 'withdrawn'] as const;

/** Shown when the candidate withdrew; the caller's message keeps describing a rejection. */
export const WITHDRAWN_APPLICATION_MESSAGE =
  'El candidato retiró su postulación a esta vacante; esta oferta ya no puede continuar.';

/**
 * Why the candidate's applications close the offer: null while there is none or one is still open,
 * otherwise 'withdrawn' when any of them was withdrawn, else 'rejected'.
 */
export function closedApplicationReason(statuses: readonly string[]): 'rejected' | 'withdrawn' | null {
  const closed: readonly string[] = CLOSED_APPLICATION_STATUSES;
  if (statuses.length === 0 || !statuses.every((status) => closed.includes(status))) return null;
  return statuses.includes('withdrawn') ? 'withdrawn' : 'rejected';
}

function assertOpen(statuses: readonly string[], message: string) {
  const reason = closedApplicationReason(statuses);
  if (reason) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: reason === 'withdrawn' ? WITHDRAWN_APPLICATION_MESSAGE : message });
  }
}
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
 * - a linked offer passes only while its application is not closed (rejected or withdrawn);
 * - an unlinked offer passes while the candidate has no application for the vacancy, or at least one that
 *   is not closed (the same rule as `assertApplicationNotRejected`).
 */
export function notRejectedApplication(vacancyId: string) {
  const open = { notIn: [...CLOSED_APPLICATION_STATUSES] };
  return {
    OR: [
      { applicationId: { not: null }, application: { status: open } },
      { applicationId: null, candidate: { applications: { none: { vacancyId } } } },
      { applicationId: null, candidate: { applications: { some: { vacancyId, status: open } } } },
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
  assertOpen(
    applications.map((application) => application.status),
    message,
  );
}

/**
 * Serializes an offer write with a concurrent rejection: locks the candidate's application row(s) for this
 * offer FOR SHARE inside the caller's transaction, then applies the same rule as
 * `assertApplicationNotRejected`. A rejection's UPDATE conflicts with the share lock, so either it committed
 * first (this read then sees `rejected` and throws) or it waits until the offer write has committed — after
 * which acceptance is final and conversion re-checks inside its own transaction.
 */
export async function lockAndAssertApplicationNotRejected(
  tx: Prisma.TransactionClient,
  organizationId: string,
  offer: OfferApplicationRef,
  message: string,
) {
  const statuses = await offerApplicationLockRepository.lockStatuses(tx, organizationId, offer);
  assertOpen(statuses, message);
}
