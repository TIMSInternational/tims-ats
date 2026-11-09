import { describe, it, expect, vi, beforeEach } from 'vitest';

// Owner default D6 on the TS reads that still serve FIT data (a minimal guard in packages/api; the rule itself is
// @tims/ai fit-visibility, the twin of the C# one): a reader below company scope gets the redacted view on the vacancy
// ranking, simulateWeights and candidate.getById, never the stored weights, and HR gets the stored row unchanged.
const { fitFindMany, candFindFirst } = vi.hoisted(() => ({ fitFindMany: vi.fn(), candFindFirst: vi.fn() }));

vi.mock('@tims/db', () => ({
  db: { auditLog: { findMany: vi.fn().mockResolvedValue([]) } },
  tenantDb: {
    fitScore: { findMany: fitFindMany },
    candidate: { findFirst: candFindFirst },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
  },
  runTenantTransaction: vi.fn(),
}));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { visibleFitScoreWhere: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../packages/api/src/services/candidate-timeline.service', () => ({
  candidateTimelineService: {},
  rejectionAuthorsById: vi.fn().mockResolvedValue(new Map()),
}));

import { fitEngineService } from '../../packages/api/src/services/fit-engine.service';
import { candidateService } from '../../packages/api/src/services/candidate.service';

const WEIGHTS = { assessment: 0.4, interview: 0.2, experience: 0.2, education: 0.1, languages: 0.1 };
const lia = (score: number) => ({
  instrument: 'lia',
  use: 'scored',
  status: 'completed',
  score,
  gate: null,
  weight: null,
  assessmentShare: 1,
  effectiveWeight: 0.4,
  min: { globalPercentile: 40 },
  reason: null,
  resultId: 'r1',
  source: 'provider',
  contentVersion: null,
  normVersion: null,
  languagesEvidence: null,
});
const v2 = (assessment: number, liaScore: number) => ({
  assessment,
  interview: 80,
  experience: 100,
  education: null,
  languages: 100,
  llmJudgment: null,
  fitVersion: 2,
  reviewPending: false,
  assessments: [lia(liaScore)],
});
const row = (id: string, overallScore: number, breakdown: unknown) => ({
  id,
  overallScore,
  breakdown,
  weights: WEIGHTS,
  isPartial: true,
  calculatedAt: new Date('2026-11-01T00:00:00Z'),
  candidate: { id: `c-${id}`, firstName: 'A', lastName: id },
});

beforeEach(() => {
  vi.clearAllMocks();
  // below: stored 73 (LIA below its minimum); met: stored 80 (LIA at its minimum, nothing hidden).
  fitFindMany.mockResolvedValue([row('met', 80, v2(100, 100)), row('below', 73, v2(50, 50))]);
});

describe('fitEngineService.getRankingForVacancy', () => {
  it('HR: the stored rows in stored order, without the weights they were read with', async () => {
    const rows = await fitEngineService.getRankingForVacancy('org-1', 'vac-1');
    expect(rows.map((r) => [r.lastName, r.overallScore])).toEqual([
      ['met', 80],
      ['below', 73],
    ]);
    expect(rows[1]!.breakdown).toEqual(v2(50, 50));
    for (const r of rows) expect('weights' in r).toBe(false);
  });

  it('a team leader: the below-minimum row is redacted, its overall recomputed (92), and the list re-sorted', async () => {
    const rows = await fitEngineService.getRankingForVacancy('org-1', 'vac-1', true);
    expect(rows.map((r) => [r.lastName, r.overallScore, r.isPartial])).toEqual([
      ['below', 92, true],
      ['met', 80, true],
    ]);
    const redacted = rows[0]!.breakdown as unknown as Record<string, unknown> & {
      assessments: Array<Record<string, unknown>>;
    };
    expect(redacted.assessment).toBeNull();
    expect(redacted.assessments[0]).toMatchObject({ score: null, belowMinimum: true });
    expect(rows[1]!.breakdown).toEqual(v2(100, 100));
    for (const r of rows) expect('weights' in r).toBe(false);
  });
});

describe('fitEngineService.simulateWeights', () => {
  const allOnAssessment = { assessment: 1, interview: 0, experience: 0, education: 0, languages: 0 };

  it('a weight of 1 on assessment cannot read a hidden dimension back for a team leader', async () => {
    const hr = await fitEngineService.simulateWeights('org-1', 'vac-1', allOnAssessment);
    expect(hr.find((r) => r.lastName === 'below')!.simulatedScore).toBe(50);

    const lead = await fitEngineService.simulateWeights('org-1', 'vac-1', allOnAssessment, true);
    const below = lead.find((r) => r.lastName === 'below')!;
    expect(below.simulatedScore).toBe(0); // the dimension is gone: no data, not the level
    expect(below.isPartial).toBe(true);
  });
});

describe('candidateService.getById fitScores', () => {
  const candidate = {
    id: 'cand-1',
    applications: [],
    fitScores: [
      {
        id: 'f1',
        overallScore: 73,
        breakdown: v2(50, 50),
        weights: WEIGHTS,
        calculatedAt: new Date('2026-11-01T00:00:00Z'),
      },
    ],
  };

  it('a team leader sees the redacted score; nobody gets the weights', async () => {
    candFindFirst.mockResolvedValue(structuredClone(candidate));
    const lead = await candidateService.getById('org-1', {}, 'cand-1', {}, true);
    expect(lead.fitScores).toEqual([
      {
        id: 'f1',
        overallScore: 92,
        breakdown: { ...v2(50, 50), assessment: null, assessments: [{ ...lia(50), score: null, belowMinimum: true }] },
        calculatedAt: new Date('2026-11-01T00:00:00Z'),
      },
    ]);

    candFindFirst.mockResolvedValue(structuredClone(candidate));
    const hr = await candidateService.getById('org-1', {}, 'cand-1', {});
    expect(hr.fitScores).toEqual([
      { id: 'f1', overallScore: 73, breakdown: v2(50, 50), calculatedAt: new Date('2026-11-01T00:00:00Z') },
    ]);
  });

  it('the detail query selects the weights it needs for the redaction', async () => {
    candFindFirst.mockResolvedValue(structuredClone(candidate));
    await candidateService.getById('org-1', {}, 'cand-1', {}, true);
    const select = candFindFirst.mock.calls[0]![0].select;
    expect(select.fitScores.select).toEqual({
      id: true,
      overallScore: true,
      breakdown: true,
      weights: true,
      calculatedAt: true,
    });
  });
});
