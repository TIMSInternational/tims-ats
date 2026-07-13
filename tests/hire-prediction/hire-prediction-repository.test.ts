import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@tims/db';
import {
  hirePredictionRepository,
  type HirePredictionSnapshot,
} from '../../packages/api/src/repositories/hire-prediction.repository';

const baseSnapshot: HirePredictionSnapshot = {
  organizationId: 'org-1',
  userId: 'user-1',
  candidateId: 'cand-1',
  vacancyId: 'vac-1',
  offerId: 'offer-1',
  applicationId: null,
  overallScore: null,
  breakdown: null,
  weights: null,
  isPartial: null,
  fitCalculatedAt: null,
  predictionStatus: 'none',
  hiredById: 'hr-1',
};

describe('hirePredictionRepository.createHirePrediction', () => {
  it('maps null Json fields to Prisma.DbNull (never plain null) and selects only id', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'hp-1' });
    const tx = { hirePrediction: { create } } as unknown as Prisma.TransactionClient;

    const result = await hirePredictionRepository.createHirePrediction(tx, baseSnapshot);

    expect(result).toEqual({ id: 'hp-1' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        offerId: 'offer-1',
        applicationId: null,
        overallScore: null,
        breakdown: Prisma.DbNull,
        weights: Prisma.DbNull,
        isPartial: null,
        fitCalculatedAt: null,
        predictionStatus: 'none',
        hiredById: 'hr-1',
      }),
      select: { id: true },
    });
  });

  it('passes populated breakdown/weights through as JSON values', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'hp-2' });
    const tx = { hirePrediction: { create } } as unknown as Prisma.TransactionClient;
    const breakdown = { assessment: 80, interview: null };
    const weights = { assessment: 0.2 };

    await hirePredictionRepository.createHirePrediction(tx, {
      ...baseSnapshot,
      overallScore: 72.5,
      breakdown,
      weights,
      isPartial: false,
      predictionStatus: 'scored',
    });

    const arg = create.mock.calls[0][0];
    expect(arg.data.breakdown).toEqual(breakdown);
    expect(arg.data.weights).toEqual(weights);
    expect(arg.data.overallScore).toBe(72.5);
    expect(arg.data.predictionStatus).toBe('scored');
  });
});

describe('fitEngineRepository.getFullFitScoreForSnapshot', () => {
  it('reads the full snapshot field set scoped to org+candidate+vacancy', async () => {
    vi.resetModules();
    const findFirst = vi.fn().mockResolvedValue({
      overallScore: 72.5, breakdown: {}, weights: {}, isPartial: false, calculatedAt: new Date(),
    });
    vi.doMock('@tims/db', async () => {
      const actual = await vi.importActual<typeof import('@tims/db')>('@tims/db');
      return { ...actual, tenantDb: { fitScore: { findFirst } } };
    });
    const { fitEngineRepository } = await import('../../packages/api/src/repositories/fit-engine.repository');

    await fitEngineRepository.getFullFitScoreForSnapshot('org-1', 'cand-1', 'vac-1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { candidateId: 'cand-1', vacancyId: 'vac-1', organizationId: 'org-1' },
      select: { overallScore: true, breakdown: true, weights: true, isPartial: true, calculatedAt: true },
    });
    vi.doUnmock('@tims/db');
  });
});
