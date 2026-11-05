import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { OPEN_OFFER_STATUSES } from '@tims/shared';
import { offerApplicationLockRepository } from '../../repositories/offer-application-lock.repository';

// One open offer per candidate and vacancy (Pilot UX audit B-04 / A-15): a second draft for the same
// application used to sit in the list and the KPIs next to the real one. Keyed on candidate + vacancy, not on
// applicationId, so an offer created without the application link counts too. An expired sent offer is no
// longer open (its link cannot be accepted), and neither is a rejected, declined or withdrawn one.

export const OPEN_OFFER_EXISTS_MESSAGE =
  'Ya existe una oferta abierta para este candidato en esta vacante. Ábrela para editarla o retírala antes de crear otra.';

const OPEN_WITHOUT_SENT = OPEN_OFFER_STATUSES.filter((status) => status !== 'sent');

/** Prisma filter for open offers (no SQL NULL trap on expiresAt): the same rule as isOpenOffer. */
export function openOfferStatusWhere(now: Date): Prisma.OfferWhereInput {
  return {
    OR: [
      { status: { in: [...OPEN_WITHOUT_SENT] } },
      { status: 'sent', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
    ],
  };
}

/** Prisma filter for the candidate's open offers for one vacancy. */
export function openOfferWhere(
  organizationId: string,
  candidateId: string,
  vacancyId: string,
  now: Date,
): Prisma.OfferWhereInput {
  return { organizationId, candidateId, vacancyId, ...openOfferStatusWhere(now) };
}

/**
 * Inside the create transaction: lock the candidate row, then refuse when an open offer exists. The lock
 * makes check-then-insert safe against a concurrent create for the same candidate.
 */
export async function assertNoOpenOffer(
  tx: Prisma.TransactionClient,
  ref: { organizationId: string; candidateId: string; vacancyId: string },
  now: Date = new Date(),
): Promise<void> {
  const found = await offerApplicationLockRepository.lockCandidate(tx, ref.organizationId, ref.candidateId);
  if (!found) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado en esta organización' });
  }
  const open = await tx.offer.findFirst({
    where: openOfferWhere(ref.organizationId, ref.candidateId, ref.vacancyId, now),
    select: { id: true },
  });
  if (open) throw new TRPCError({ code: 'CONFLICT', message: OPEN_OFFER_EXISTS_MESSAGE });
}
