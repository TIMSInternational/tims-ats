import { Prisma } from '@tims/db';

/** Plain, Prisma-free snapshot produced by the pure builder in the service layer. */
export interface HirePredictionSnapshot {
  organizationId: string;
  userId: string;
  candidateId: string;
  vacancyId: string;
  offerId: string;
  applicationId: string | null;
  overallScore: number | null;
  breakdown: unknown;
  weights: unknown;
  isPartial: boolean | null;
  fitCalculatedAt: Date | null;
  predictionStatus: 'scored' | 'partial' | 'none';
  hiredById: string;
}

export const hirePredictionRepository = {
  /**
   * Persist an immutable HirePrediction inside the caller's transaction.
   * Nullable Json columns require Prisma.DbNull (plain null does not type-check).
   */
  async createHirePrediction(tx: Prisma.TransactionClient, snapshot: HirePredictionSnapshot) {
    return tx.hirePrediction.create({
      data: {
        organizationId: snapshot.organizationId,
        userId: snapshot.userId,
        candidateId: snapshot.candidateId,
        vacancyId: snapshot.vacancyId,
        offerId: snapshot.offerId,
        applicationId: snapshot.applicationId,
        overallScore: snapshot.overallScore,
        breakdown: snapshot.breakdown === null ? Prisma.DbNull : (snapshot.breakdown as Prisma.InputJsonValue),
        weights: snapshot.weights === null ? Prisma.DbNull : (snapshot.weights as Prisma.InputJsonValue),
        isPartial: snapshot.isPartial,
        fitCalculatedAt: snapshot.fitCalculatedAt,
        predictionStatus: snapshot.predictionStatus,
        hiredById: snapshot.hiredById,
      },
      select: { id: true },
    });
  },
};
