import { describe, it, expect, vi, beforeEach } from 'vitest';

// #312: computeForVacancy must SKIP pipeline candidates whose recruitment consent is withdrawn — no reads, no
// score, no fit_scores upsert — and report only the candidates actually scored.
const getPipelineCandidateIds = vi.fn();
const upsertFitScore = vi.fn();
const withdrawnCandidateIds = vi.fn();

vi.mock('../../packages/api/src/repositories/fit-engine.repository', () => ({
  fitEngineRepository: {
    getPipelineCandidateIds: (...a: unknown[]) => getPipelineCandidateIds(...a),
    getCandidateForFit: vi.fn(async () => ({ yearsExperience: 5, education: null, languages: null })),
    getVacancyForFit: vi.fn(async () => ({ roleFamily: null, jobProfile: null })),
    getLatestAssessmentScore: vi.fn(async () => 80),
    getLatestInterviewFitScore: vi.fn(async () => null),
    findWeightProfile: vi.fn(async () => ({
      id: 'p',
      name: 'Default',
      weights: { assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2 },
    })),
    upsertWeightProfile: vi.fn(),
    upsertFitScore: (...a: unknown[]) => upsertFitScore(...a),
  },
}));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { withdrawnCandidateIds: (...a: unknown[]) => withdrawnCandidateIds(...a) },
}));

import { fitEngineService } from '../../packages/api/src/services/fit-engine.service';

beforeEach(() => {
  vi.clearAllMocks();
  upsertFitScore.mockResolvedValue({ id: 'fs' });
});

describe('fitEngineService.computeForVacancy — #312 consent guard', () => {
  it('skips withdrawn candidates and counts only the candidates actually scored', async () => {
    getPipelineCandidateIds.mockResolvedValue(['c-1', 'c-withdrawn', 'c-2']);
    withdrawnCandidateIds.mockResolvedValue(new Set(['c-withdrawn']));

    const result = await fitEngineService.computeForVacancy('org-1', 'vac-1');

    expect(withdrawnCandidateIds).toHaveBeenCalledWith('org-1', ['c-1', 'c-withdrawn', 'c-2']);
    expect(result).toEqual({ computed: 2 });
    const scored = upsertFitScore.mock.calls.map((c) => c[1]);
    expect(scored.sort()).toEqual(['c-1', 'c-2']);
  });

  it('writes nothing when every candidate withdrew', async () => {
    getPipelineCandidateIds.mockResolvedValue(['c-withdrawn']);
    withdrawnCandidateIds.mockResolvedValue(new Set(['c-withdrawn']));

    expect(await fitEngineService.computeForVacancy('org-1', 'vac-1')).toEqual({ computed: 0 });
    expect(upsertFitScore).not.toHaveBeenCalled();
  });

  it('scores everyone when nobody withdrew', async () => {
    getPipelineCandidateIds.mockResolvedValue(['c-1', 'c-2']);
    withdrawnCandidateIds.mockResolvedValue(new Set());

    expect(await fitEngineService.computeForVacancy('org-1', 'vac-1')).toEqual({ computed: 2 });
    expect(upsertFitScore).toHaveBeenCalledTimes(2);
  });
});
