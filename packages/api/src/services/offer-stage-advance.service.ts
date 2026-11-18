import type { Prisma } from '@tims/db';
import type { OfferApplicationRef } from '../repositories/offer-application-lock.repository';
import {
  offerStageRepository,
  type LockedOfferApplication,
  type VacancyStage,
} from '../repositories/offer-stage.repository';

// Founder request (pilot call 2026-11-05): when an offer is SENT for signature, the candidate moves to the
// vacancy's "Oferta" stage if they are still in an earlier one. Only the confirmed hire moved a stage before
// (hire-closure.service.ts), so a candidate with a signed offer could still sit in "Entrevista final".
//
// - The stage: PipelineStage has no type/kind column (pipeline.prisma), so it is the stage NAMED "Oferta" — the
//   default pipeline's (vacancy/default-stages.ts), matched case- and accent-insensitively like
//   lib/pipeline-next-actions.ts does. A vacancy that renamed or removed it is left alone.
// - Never backwards: only from a stage ordered BEFORE it ("Contratado", or "Oferta" itself, stays put).
// - Only an ACTIVE application: a rejected, withdrawn or hired one is never touched.
// - Inside the send transaction, under the application row lock taken before the send's re-checks, with a
//   StageMovement "Oferta enviada" — the same writes as a manual move.

export const OFFER_SENT_STAGE_MOVE_REASON = 'Oferta enviada';
const OFFER_STAGE_NAME = 'oferta';
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalizeStageName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(COMBINING_DIACRITICS, '');
}

/** The vacancy's offer stage: the first stage named "Oferta" (any case or accents), or null. */
export function findOfferStage(stages: readonly VacancyStage[]): VacancyStage | null {
  const named = stages.filter((stage) => normalizeStageName(stage.name) === OFFER_STAGE_NAME);
  return named.sort((a, b) => a.order - b.order)[0] ?? null;
}

export type OfferStageDecision =
  | { kind: 'move'; application: LockedOfferApplication; toStageId: string }
  | { kind: 'skip'; reason: 'no_active_application' | 'no_offer_stage' | 'not_earlier' };

/** Pure: whether (and where) the sent offer moves its application. */
export function decideOfferStageMove(
  applications: readonly LockedOfferApplication[],
  stages: readonly VacancyStage[],
): OfferStageDecision {
  // One application per candidate and vacancy (@@unique([candidateId, vacancyId])); only an active one moves.
  const application = applications.find((app) => app.status === 'active');
  if (!application) return { kind: 'skip', reason: 'no_active_application' };
  const offerStage = findOfferStage(stages);
  if (!offerStage) return { kind: 'skip', reason: 'no_offer_stage' };
  const current = stages.find((stage) => stage.id === application.currentStageId);
  // An unknown current stage is not provably earlier: leave it.
  if (!current || current.order >= offerStage.order) return { kind: 'skip', reason: 'not_earlier' };
  return { kind: 'move', application, toStageId: offerStage.id };
}

export type OfferStageAdvanceResult =
  | 'moved'
  | 'changed_meanwhile'
  | Extract<OfferStageDecision, { kind: 'skip' }>['reason'];

/**
 * Call at the START of the send transaction (it takes the application lock), then `advance` once the offer
 * transition matched (never for a send that did not happen).
 */
export async function prepareOfferStageAdvance(
  tx: Prisma.TransactionClient,
  organizationId: string,
  offer: OfferApplicationRef,
): Promise<{ advance: (movedBy: string) => Promise<OfferStageAdvanceResult> }> {
  const applications = await offerStageRepository.lockApplications(tx, organizationId, offer);
  return {
    async advance(movedBy) {
      if (!applications.some((app) => app.status === 'active')) return 'no_active_application';
      const decision = decideOfferStageMove(
        applications,
        await offerStageRepository.vacancyStages(tx, organizationId, offer.vacancyId),
      );
      if (decision.kind === 'skip') return decision.reason;
      const moved = await offerStageRepository.moveToStage(tx, {
        organizationId,
        applicationId: decision.application.id,
        fromStageId: decision.application.currentStageId,
        toStageId: decision.toStageId,
        movedBy,
        reason: OFFER_SENT_STAGE_MOVE_REASON,
      });
      return moved ? 'moved' : 'changed_meanwhile';
    },
  };
}
