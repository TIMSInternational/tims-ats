import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral test for getInclusionIndex min-5 floor (slice 6 round 5, HIGH 2) ─
// getInclusionIndex previously returned totalResponses + an inclusion average with NO
// suppression. A 3-respondent survey leaked totalResponses:3 and an index over 3
// people. It must now mirror getClimateHeatmap/getSurveyResults: a survey with 1..4
// respondents (or fewer than 5 distinct inclusion contributors) suppresses the result.

const surveyFindFirst = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: { survey: { findFirst: (...a: unknown[]) => surveyFindFirst(...a) } },
}));

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<{ user: { organizationId: string; id: string } }>().create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

// deiService is not exercised here (getInclusionIndex reads survey directly), but the
// router imports it — provide a stub so the module loads.
vi.mock('../../packages/api/src/services/dei.service', () => ({ deiService: {} }));

import { deiRouter } from '../../packages/api/src/routers/dei';

interface InclusionResult {
  index: number | null;
  totalResponses: number | null;
  suppressed?: boolean;
  questionsEvaluated?: number;
}
interface InclusionCaller {
  getInclusionIndex(input?: { surveyId?: string }): Promise<InclusionResult>;
}

const t = initTRPC.context<{ user: { organizationId: string; id: string } }>().create();
const createCaller = t.createCallerFactory(deiRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);
const caller = () => createCaller({ user: { organizationId: 'org-1', id: 'u-1' } }) as unknown as InclusionCaller;

// A climate survey: `questions` is a JSON array; each response's `answers` map keys by
// question text. The inclusion score is the answer to a category:'inclusion' question.
const inclusionQuestion = { text: 'I feel included', category: 'inclusion' };
const resp = (score: number) => ({ answers: { 'I feel included': score } });

beforeEach(() => vi.clearAllMocks());

describe('getInclusionIndex min-5 floor (HIGH 2)', () => {
  it('suppresses index + totalResponses for a 3-respondent survey (has inclusion question)', async () => {
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      questions: [inclusionQuestion],
      responses: [resp(80), resp(70), resp(90)], // 3 respondents
    });
    const r = await caller().getInclusionIndex();
    expect(r.suppressed).toBe(true);
    expect(r.index).toBeNull();
    expect(r.totalResponses).toBeNull();
  });

  it('suppresses the raw total for a 3-respondent survey with NO inclusion question', async () => {
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      questions: [{ text: 'Other', category: 'culture' }],
      responses: [resp(1), resp(2), resp(3)], // 3 respondents, none inclusion
    });
    const r = await caller().getInclusionIndex();
    expect(r.suppressed).toBe(true);
    expect(r.index).toBeNull();
    expect(r.totalResponses).toBeNull();
  });

  it('returns a real index + total when >= 5 distinct respondents contribute', async () => {
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      questions: [inclusionQuestion],
      responses: [resp(80), resp(60), resp(100), resp(70), resp(90)], // 5 → avg 80
    });
    const r = await caller().getInclusionIndex();
    expect(r.suppressed).toBe(false);
    expect(r.index).toBe(80);
    expect(r.totalResponses).toBe(5);
  });

  it('suppresses the index when the survey has >=5 respondents but <5 actually answered the inclusion question', async () => {
    // 6 respondents to the survey, but only 3 answered the inclusion question.
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      questions: [inclusionQuestion],
      responses: [resp(80), resp(70), resp(90), { answers: {} }, { answers: {} }, { answers: {} }],
    });
    const r = await caller().getInclusionIndex();
    expect(r.suppressed).toBe(true);
    expect(r.index).toBeNull();
    // totalResponses (>=5 survey-level) may pass through, but the index is masked.
    expect(r.index).toBeNull();
  });

  it('returns null index + null total (unsuppressed) when there is no climate survey', async () => {
    surveyFindFirst.mockResolvedValue(null);
    const r = await caller().getInclusionIndex();
    expect(r.index).toBeNull();
    expect(r.totalResponses).toBeNull();
    expect(r.suppressed).toBe(false);
  });
});
