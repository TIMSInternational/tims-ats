import { describe, it, expect, vi } from 'vitest';
import {
  buildHirePredictionSnapshot,
  type BuildHirePredictionInput,
} from '../../packages/api/src/services/hire-prediction.service';

const baseInput: Omit<BuildHirePredictionInput, 'fitScore'> = {
  organizationId: 'org-1',
  userId: 'user-1',
  candidateId: 'cand-1',
  vacancyId: 'vac-1',
  offerId: 'offer-1',
  applicationId: 'app-1',
  hiredById: 'hr-1',
};

const calculatedAt = new Date('2026-07-01T00:00:00.000Z');

describe('buildHirePredictionSnapshot', () => {
  it('marks a non-partial score as "scored" and copies the frozen fields', () => {
    const snap = buildHirePredictionSnapshot({
      ...baseInput,
      fitScore: { overallScore: 80, breakdown: { assessment: 80 }, weights: { assessment: 0.2 }, isPartial: false, calculatedAt },
    });
    expect(snap.predictionStatus).toBe('scored');
    expect(snap.overallScore).toBe(80);
    expect(snap.breakdown).toEqual({ assessment: 80 });
    expect(snap.weights).toEqual({ assessment: 0.2 });
    expect(snap.isPartial).toBe(false);
    expect(snap.fitCalculatedAt).toBe(calculatedAt);
    expect(snap.applicationId).toBe('app-1');
  });

  it('marks a partial score as "partial"', () => {
    const snap = buildHirePredictionSnapshot({
      ...baseInput,
      fitScore: { overallScore: 40, breakdown: {}, weights: {}, isPartial: true, calculatedAt },
    });
    expect(snap.predictionStatus).toBe('partial');
    expect(snap.isPartial).toBe(true);
  });

  it('marks a missing score as "none" with all snapshot fields null', () => {
    const snap = buildHirePredictionSnapshot({ ...baseInput, applicationId: null, fitScore: null });
    expect(snap.predictionStatus).toBe('none');
    expect(snap.overallScore).toBeNull();
    expect(snap.breakdown).toBeNull();
    expect(snap.weights).toBeNull();
    expect(snap.isPartial).toBeNull();
    expect(snap.fitCalculatedAt).toBeNull();
    expect(snap.applicationId).toBeNull();
  });
});

describe('hirePredictionService.readFitForHire', () => {
  it('reads the FitScore via the fit-engine repository and returns it as-is', async () => {
    vi.resetModules();
    const fixture = {
      overallScore: 90, breakdown: {}, weights: {}, isPartial: false, calculatedAt: new Date('2026-07-01'),
    };
    const getFull = vi.fn().mockResolvedValue(fixture);
    vi.doMock('../../packages/api/src/repositories/fit-engine.repository', () => ({
      fitEngineRepository: { getFullFitScoreForSnapshot: getFull },
    }));
    const { hirePredictionService } = await import('../../packages/api/src/services/hire-prediction.service');

    const result = await hirePredictionService.readFitForHire('org-1', 'cand-1', 'vac-1');

    expect(getFull).toHaveBeenCalledWith('org-1', 'cand-1', 'vac-1');
    expect(result).toBe(fixture);
    vi.doUnmock('../../packages/api/src/repositories/fit-engine.repository');
  });
});

describe('hirePredictionService.writeSnapshot', () => {
  it('builds the snapshot from the pre-read fitScore and persists it on the given tx', async () => {
    vi.resetModules();
    const createHp = vi.fn().mockResolvedValue({ id: 'hp-1' });
    vi.doMock('../../packages/api/src/repositories/hire-prediction.repository', () => ({
      hirePredictionRepository: { createHirePrediction: createHp },
    }));
    const { hirePredictionService } = await import('../../packages/api/src/services/hire-prediction.service');
    const tx = { __tx: true } as never;

    await hirePredictionService.writeSnapshot(tx, {
      organizationId: 'org-1', userId: 'user-1', candidateId: 'cand-1', vacancyId: 'vac-1',
      offerId: 'offer-1', applicationId: null, hiredById: 'hr-1',
      fitScore: { overallScore: 90, breakdown: {}, weights: {}, isPartial: false, calculatedAt: new Date('2026-07-01') },
    });

    expect(createHp).toHaveBeenCalledTimes(1);
    const [passedTx, snapshot] = createHp.mock.calls[0];
    expect(passedTx).toBe(tx);
    expect(snapshot).toMatchObject({ predictionStatus: 'scored', overallScore: 90, userId: 'user-1', offerId: 'offer-1' });
    vi.doUnmock('../../packages/api/src/repositories/hire-prediction.repository');
  });
});
