import { describe, it, expect, vi, beforeEach } from 'vitest';

// #312: withdrawn candidates' EXISTING fit_scores rows are hidden (never deleted) on every read surface. The
// filter comes from candidateConsentRepository.visibleFitScoreWhere and is applied inside the same Prisma query.
const HIDDEN = { candidateId: { notIn: ['c-withdrawn'] } };
const visibleFitScoreWhere = vi.fn();

const { fitFindMany, fitFindFirst, candFindMany, candFindFirst } = vi.hoisted(() => ({
  fitFindMany: vi.fn(),
  fitFindFirst: vi.fn(),
  candFindMany: vi.fn(),
  candFindFirst: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    fitScore: { findMany: fitFindMany, findFirst: fitFindFirst },
    candidate: { findMany: candFindMany, findFirst: candFindFirst },
  },
  runTenantTransaction: vi.fn(),
}));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { visibleFitScoreWhere: (...a: unknown[]) => visibleFitScoreWhere(...a) },
}));

import { fitEngineService } from '../../packages/api/src/services/fit-engine.service';
import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

beforeEach(() => {
  vi.clearAllMocks();
  visibleFitScoreWhere.mockResolvedValue(HIDDEN);
  fitFindMany.mockResolvedValue([]);
  fitFindFirst.mockResolvedValue(null);
  candFindMany.mockResolvedValue([]);
  candFindFirst.mockResolvedValue(null);
});

describe('fit-engine read surfaces hide withdrawn candidates', () => {
  it('ranking queries with the withdrawn filter AND-ed into the vacancy where', async () => {
    await fitEngineService.getRankingForVacancy('org-1', 'vac-1');
    expect(visibleFitScoreWhere).toHaveBeenCalledWith('org-1');
    expect(fitFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', vacancyId: 'vac-1', AND: [HIDDEN] } }),
    );
  });

  it('simulateWeights uses the same filtered read', async () => {
    await fitEngineService.simulateWeights('org-1', 'vac-1', {
      assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2,
    });
    expect(fitFindMany.mock.calls[0]?.[0]?.where).toEqual({ organizationId: 'org-1', vacancyId: 'vac-1', AND: [HIDDEN] });
  });

  it('explain keeps the candidate equality AND the withdrawn filter (no key overwrite)', async () => {
    const result = await fitEngineService.getFitScoreForExplain('org-1', 'c-withdrawn', 'vac-1');
    expect(result).toBeNull();
    expect(fitFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      candidateId: 'c-withdrawn', vacancyId: 'vac-1', organizationId: 'org-1', AND: [HIDDEN],
    });
  });

  it('applies no extra restriction when nobody withdrew', async () => {
    visibleFitScoreWhere.mockResolvedValue({});
    await fitEngineService.getRankingForVacancy('org-1', 'vac-1');
    expect(fitFindMany.mock.calls[0]?.[0]?.where).toEqual({ organizationId: 'org-1', vacancyId: 'vac-1', AND: [{}] });
  });
});

describe('candidate read surfaces hide withdrawn candidates’ fit scores', () => {
  it('candidate detail fitScores carry the withdrawn filter', async () => {
    await candidateRepository.getById('org-1', {}, 'c-withdrawn', {});
    const select = candFindFirst.mock.calls[0]?.[0]?.select as Record<string, { where?: unknown }>;
    expect(select.fitScores?.where).toEqual({ AND: [{}, HIDDEN] });
  });

  it('candidate list latest-fit child AND the fit-range filter carry the withdrawn filter', async () => {
    await candidateRepository.list('org-1', {}, {}, { limit: 10, fitMin: 50 });
    const args = candFindMany.mock.calls[0]?.[0] as {
      where: { AND: Array<Record<string, unknown>> };
      select: Record<string, { where?: unknown }>;
    };
    expect(args.select.fitScores?.where).toEqual({ AND: [{}, HIDDEN] });
    const filterClause = args.where.AND[2] as { fitScores?: { some: { AND: unknown[] } } };
    expect(filterClause.fitScores?.some.AND).toContainEqual(HIDDEN);
  });

  it('candidate risks read carries the withdrawn filter', async () => {
    await candidateRepository.getCandidateForRisks('org-1', 'c-withdrawn', {});
    const select = candFindFirst.mock.calls[0]?.[0]?.select as Record<string, { where?: unknown }>;
    expect(select.fitScores?.where).toEqual({ AND: [{}, HIDDEN] });
  });
});
