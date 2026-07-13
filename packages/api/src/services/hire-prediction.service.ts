import type { Prisma } from '@tims/db';
import { fitEngineRepository } from '../repositories/fit-engine.repository';
import { hirePredictionRepository, type HirePredictionSnapshot } from '../repositories/hire-prediction.repository';

/** The FitScore fields the snapshot freezes (structurally matches getFullFitScoreForSnapshot). */
export interface SnapshotFitScore {
  overallScore: number;
  breakdown: unknown;
  weights: unknown;
  isPartial: boolean;
  calculatedAt: Date;
}

export interface BuildHirePredictionInput {
  organizationId: string;
  userId: string;
  candidateId: string;
  vacancyId: string;
  offerId: string;
  applicationId: string | null;
  hiredById: string;
  fitScore: SnapshotFitScore | null;
}

/** Pure: map a FitScore (or its absence) into an immutable HirePrediction snapshot. */
export function buildHirePredictionSnapshot(input: BuildHirePredictionInput): HirePredictionSnapshot {
  const fs = input.fitScore;
  const predictionStatus: HirePredictionSnapshot['predictionStatus'] =
    fs === null ? 'none' : fs.isPartial ? 'partial' : 'scored';
  return {
    organizationId: input.organizationId,
    userId: input.userId,
    candidateId: input.candidateId,
    vacancyId: input.vacancyId,
    offerId: input.offerId,
    applicationId: input.applicationId,
    overallScore: fs ? fs.overallScore : null,
    breakdown: fs ? fs.breakdown : null,
    weights: fs ? fs.weights : null,
    isPartial: fs ? fs.isPartial : null,
    fitCalculatedAt: fs ? fs.calculatedAt : null,
    predictionStatus,
    hiredById: input.hiredById,
  };
}

export const hirePredictionService = {
  /**
   * Read the candidate's current FIT score (if any). Call this BEFORE the hire
   * transaction — a standalone tenantDb read must not run nested inside the
   * interactive $transaction (it would hold a second pool connection and can
   * pool-starve under concurrency). The snapshot is a point-in-time capture, so
   * reading just before the tx is equivalent.
   */
  async readFitForHire(organizationId: string, candidateId: string, vacancyId: string) {
    return fitEngineRepository.getFullFitScoreForSnapshot(organizationId, candidateId, vacancyId);
  },

  /** Build + persist the immutable snapshot on the caller's transaction, using the pre-read fitScore. */
  async writeSnapshot(tx: Prisma.TransactionClient, input: BuildHirePredictionInput): Promise<void> {
    const snapshot = buildHirePredictionSnapshot(input);
    await hirePredictionRepository.createHirePrediction(tx, snapshot);
  },
};
