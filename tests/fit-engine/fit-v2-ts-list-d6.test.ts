import { describe, it, expect, vi, beforeEach } from 'vitest';

// Owner default D6 on the TS LIST surfaces (Codex release round 2 [P1]): the stored overall of a FIT v2 row that hides a
// level inverts back to it (with the visible dimensions and the weight profile), so a reader below company scope gets
// the stored D6 overall (`restricted_overall_score`, written by the C# compute) on the candidate list, its fit-range
// filter, the pipeline board and the risk factors. HR keeps the stored overall; the restricted value never leaves.
const { candFindMany, candFindFirst, stageFindMany, vacancyFindFirst } = vi.hoisted(() => ({
  candFindMany: vi.fn(),
  candFindFirst: vi.fn(),
  stageFindMany: vi.fn(),
  vacancyFindFirst: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  db: { auditLog: { findMany: vi.fn().mockResolvedValue([]) } },
  tenantDb: {
    candidate: { findMany: candFindMany, findFirst: candFindFirst },
    pipelineStage: { findMany: stageFindMany },
    vacancy: { findFirst: vacancyFindFirst },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
  },
  runTenantTransaction: vi.fn(),
}));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { visibleFitScoreWhere: vi.fn().mockResolvedValue({}) },
}));

import { candidateService } from '../../packages/api/src/services/candidate.service';
import { pipelineService } from '../../packages/api/src/services/pipeline.service';
import { fitOverallRangeWhere } from '../../packages/ai/src/fit-visibility';

const hidden = {
  id: 'f1',
  overallScore: 60,
  restrictedOverallScore: 80,
  calculatedAt: new Date('2026-11-01T00:00:00Z'),
};
const plain = {
  id: 'f2',
  overallScore: 55,
  restrictedOverallScore: null,
  calculatedAt: new Date('2026-11-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  candFindMany.mockResolvedValue([
    { id: 'c1', fitScores: [structuredClone(hidden)] },
    { id: 'c2', fitScores: [structuredClone(plain)] },
  ]);
});

describe('candidate.list', () => {
  it('a narrow reader sees the D6 overall where one is stored; HR the stored one; nobody the restricted key', async () => {
    const lead = await candidateService.list('org-1', {}, {}, { limit: 20 }, true);
    expect(lead.items.map((c) => c.fitScores[0]!.overallScore)).toEqual([80, 55]);
    const hr = await candidateService.list('org-1', {}, {}, { limit: 20 });
    expect(hr.items.map((c) => c.fitScores[0]!.overallScore)).toEqual([60, 55]);
    for (const c of [...lead.items, ...hr.items]) expect('restrictedOverallScore' in c.fitScores[0]!).toBe(false);
  });

  it("a narrow reader's fit-range filter runs on the overall it sees, so it cannot probe the hidden one", async () => {
    await candidateService.list('org-1', {}, {}, { limit: 20, fitMin: 59, fitMax: 61 }, true);
    const where = candFindMany.mock.calls[0]![0].where;
    const fitFilter = where.AND[2].fitScores.some.AND[0];
    expect(fitFilter).toEqual({
      OR: [
        { restrictedOverallScore: { gte: 59, lte: 61 } },
        { restrictedOverallScore: null, overallScore: { gte: 59, lte: 61 } },
      ],
    });
    expect(candFindMany.mock.calls[0]![0].select.fitScores.select.restrictedOverallScore).toBe(true);

    candFindMany.mockClear();
    await candidateService.list('org-1', {}, {}, { limit: 20, fitMin: 59, fitMax: 61 });
    expect(candFindMany.mock.calls[0]![0].where.AND[2].fitScores.some.AND[0]).toEqual({
      overallScore: { gte: 59, lte: 61 },
    });
    expect(fitOverallRangeWhere({ gte: 1 }, false)).toEqual({ overallScore: { gte: 1 } });
  });
});

describe('pipeline.getBoard', () => {
  it('cards carry the D6 overall (and partial) for a narrow reader, the stored overall for HR', async () => {
    vacancyFindFirst.mockResolvedValue({ id: 'v1' });
    const board = () => [
      {
        id: 's1',
        applications: [
          {
            id: 'a1',
            appliedAt: new Date('2026-11-01T00:00:00Z'),
            movements: [],
            candidate: { id: 'c1', fitScores: [{ overallScore: 60, restrictedOverallScore: 80, isPartial: false }] },
          },
        ],
      },
    ];
    stageFindMany.mockResolvedValueOnce(board()).mockResolvedValueOnce(board());

    const lead = await pipelineService.getBoard('org-1', 'v1', 'active', true);
    expect(lead.stages[0]!.applications[0]!.candidate.fitScores).toEqual([{ overallScore: 80, isPartial: true }]);
    const hr = await pipelineService.getBoard('org-1', 'v1', 'active');
    expect(hr.stages[0]!.applications[0]!.candidate.fitScores).toEqual([{ overallScore: 60, isPartial: false }]);
  });
});

describe('candidate.getRisks', () => {
  it('the risk factor reads the overall the reader may see', async () => {
    candFindFirst.mockResolvedValue({
      id: 'c1',
      applications: [],
      fitScores: [{ overallScore: 30, restrictedOverallScore: 70 }],
    });
    const lead = await candidateService.getRisks('org-1', 'c1', {}, true);
    expect(lead.factors[0]!.value).toBe(70);
    expect(lead.overallRisk).toBe('low');

    candFindFirst.mockResolvedValue({
      id: 'c1',
      applications: [],
      fitScores: [{ overallScore: 30, restrictedOverallScore: 70 }],
    });
    const hr = await candidateService.getRisks('org-1', 'c1', {});
    expect(hr.factors[0]!.value).toBe(30);
    expect(hr.overallRisk).toBe('high');
  });
});
