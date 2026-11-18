import type { Prisma } from '@tims/db';
import type { OfferApplicationRef } from './offer-application-lock.repository';

export type LockedOfferApplication = { id: string; status: string; currentStageId: string };
export type VacancyStage = { id: string; name: string; order: number };

// Data access for moving the candidate to the vacancy's "Oferta" stage when the offer is sent
// (services/offer-stage-advance.service.ts). Everything runs inside the caller's send transaction.
export const offerStageRepository = {
  /**
   * Locks the offer's application row(s) FOR NO KEY UPDATE — the mode the stage UPDATE takes — BEFORE the send's
   * FOR SHARE re-check (rejected-application-guard.ts). Taking the stronger lock first makes two concurrent sends
   * of one offer queue here instead of both holding FOR SHARE and deadlocking on the upgrade; it also serializes
   * with a concurrent stage move or rejection, so the stage read below is the real one.
   */
  async lockApplications(
    tx: Prisma.TransactionClient,
    organizationId: string,
    offer: OfferApplicationRef,
  ): Promise<LockedOfferApplication[]> {
    return offer.applicationId
      ? tx.$queryRaw<LockedOfferApplication[]>`
          SELECT id, status, current_stage_id AS "currentStageId" FROM applications
          WHERE id = ${offer.applicationId}::uuid AND organization_id = ${organizationId}::uuid
          FOR NO KEY UPDATE`
      : tx.$queryRaw<LockedOfferApplication[]>`
          SELECT id, status, current_stage_id AS "currentStageId" FROM applications
          WHERE organization_id = ${organizationId}::uuid
            AND candidate_id = ${offer.candidateId}::uuid
            AND vacancy_id = ${offer.vacancyId}::uuid
          FOR NO KEY UPDATE`;
  },

  async vacancyStages(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vacancyId: string,
  ): Promise<VacancyStage[]> {
    return tx.pipelineStage.findMany({
      where: { vacancyId, organizationId },
      select: { id: true, name: true, order: true },
      orderBy: { order: 'asc' },
    });
  },

  /**
   * Compare-and-set move (still active, still in `fromStageId`) plus its stage-history row, like a manual move
   * (pipeline.repository.ts). Returns false when the application changed meanwhile: nothing is written then.
   */
  async moveToStage(
    tx: Prisma.TransactionClient,
    move: {
      organizationId: string;
      applicationId: string;
      fromStageId: string;
      toStageId: string;
      movedBy: string;
      reason: string;
    },
  ): Promise<boolean> {
    const moved = await tx.application.updateMany({
      where: {
        id: move.applicationId,
        organizationId: move.organizationId,
        status: 'active',
        currentStageId: move.fromStageId,
      },
      data: { currentStageId: move.toStageId },
    });
    if (moved.count !== 1) return false;
    await tx.stageMovement.create({
      data: {
        organizationId: move.organizationId,
        applicationId: move.applicationId,
        fromStageId: move.fromStageId,
        toStageId: move.toStageId,
        movedBy: move.movedBy,
        reason: move.reason,
      },
      select: { id: true },
    });
    return true;
  },
};
