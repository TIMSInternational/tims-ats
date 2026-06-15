import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral tests for the contributor/skip-bucket oracles (slice 6 round 9) ──
// FIX 1 — getSurveyResults: a 9-response survey with an optional question answered
//   by 5 (skipped by 4) leaks the 1..4 skip bucket via totalResponses − count. The
//   per-question all-or-nothing pass must now trigger on the SKIP bucket too and
//   return an EMPTY questionSummaries array + suppressed.
// FIX 2 — getResultsByArea: an area with 5 respondents but only 1 numeric contributor
//   computes an average over that single person. The trigger must fold in the numeric-
//   contributor count (and its skip bucket) and return EMPTY results + suppressed.
//
// Same harness as enps-suppression.test.ts: mock `../trpc` so permissionProcedure is a
// bare pass-through, mock @tims/db, keep the REAL suppressBelowMin5, no-op the org gate.

const surveyFindFirst = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    survey: { findFirst: (...a: unknown[]) => surveyFindFirst(...a) },
  },
}));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>(
    '../../packages/api/src/access',
  );
  return {
    ...actual,
    requireOrgScope: vi.fn(),
    assertScoped: vi.fn(),
    assertSubjectInScope: vi.fn(),
    scopeWhereFor: vi.fn(async () => ({})),
  };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { engagementRouter } from '../../packages/api/src/routers/engagement';

interface QuestionSummary {
  question: unknown;
  type: unknown;
  average?: number | null;
  count: number | null;
  suppressed: boolean;
}
interface SurveyResults {
  surveyId: string;
  title: string;
  totalResponses: number | null;
  suppressed: boolean;
  questionSummaries: QuestionSummary[];
}
interface AreaOut {
  groupId: string;
  average: number | null;
  responses: number | null;
  suppressed: boolean;
}
interface AreaResults {
  surveyId: string;
  groupBy: string;
  results: AreaOut[];
  suppressed: boolean;
}
interface EngagementCaller {
  getSurveyResults(input: { surveyId: string }): Promise<SurveyResults>;
  getResultsByArea(input: { surveyId: string; groupBy?: 'company' | 'businessUnit' | 'team' }): Promise<AreaResults>;
}

const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
const createCaller = t.createCallerFactory(
  engagementRouter as unknown as Parameters<typeof t.createCallerFactory>[0],
);
const ctx = { user: { organizationId: 'org-1', id: 'u-1' }, access: {} };
const caller = () => createCaller(ctx) as unknown as EngagementCaller;

const UUID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => vi.clearAllMocks());

describe('getSurveyResults per-question skip-bucket suppression (FIX 1)', () => {
  it('empties questionSummaries + suppresses when an optional question answered by 5 / skipped by 4 (9-response survey)', async () => {
    // One optional scale question. 5 of 9 respondents answered it → skip = 9 − 5 = 4.
    // The contributor count (5) clears the floor, but the skip bucket (4) does not.
    const answered = Array.from({ length: 5 }, () => ({ answers: { Q: 7 } }));
    const skipped = Array.from({ length: 4 }, () => ({ answers: {} }));
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      title: 'Pulse',
      questions: [{ text: 'Q', type: 'scale' }],
      responses: [...answered, ...skipped], // 9 total
    });

    const r = await caller().getSurveyResults({ surveyId: UUID });
    expect(r.suppressed).toBe(true);
    expect(r.questionSummaries).toEqual([]); // no per-question keys → 9 − null unsolvable
  });

  it('returns real per-question summaries when every question is answered by all (no skip bucket)', async () => {
    // 6 respondents, all answer the one question → contributor=6, skip=0. Nothing fires.
    const responses = Array.from({ length: 6 }, (_, i) => ({ answers: { Q: 6 + (i % 3) } }));
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      title: 'Pulse',
      questions: [{ text: 'Q', type: 'scale' }],
      responses,
    });

    const r = await caller().getSurveyResults({ surveyId: UUID });
    expect(r.suppressed).toBe(false);
    expect(r.questionSummaries.length).toBe(1);
    expect(r.questionSummaries[0]!.count).toBe(6);
  });
});

describe('getResultsByArea numeric-contributor suppression (FIX 2)', () => {
  it('empties results + suppresses when an area has 5 respondents but only 1 numeric contributor', async () => {
    // Area A: 5 respondents to the survey, but only ONE supplied a numeric answer.
    // respondents=5 clears the floor; numericContributors=1 does not → average must
    // never be computed over that single person.
    const numeric = { answers: { Q: 9 }, user: { companyId: 'A', businessUnitId: null } };
    const nonNumeric = Array.from({ length: 4 }, () => ({
      answers: { Q: 'n/a' },
      user: { companyId: 'A', businessUnitId: null },
    }));
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      responses: [numeric, ...nonNumeric],
    });

    const r = await caller().getResultsByArea({ surveyId: UUID, groupBy: 'company' });
    expect(r.suppressed).toBe(true);
    expect(r.results).toEqual([]); // no area keys → no 1-contributor average
  });

  it('returns area averages when respondents and numeric contributors both clear the floor', async () => {
    // Area A: 5 respondents, all 5 give a numeric answer → respondents=5, contributors=5,
    // skip=0. Nothing fires; the average publishes.
    const responses = Array.from({ length: 5 }, () => ({
      answers: { Q: 8 },
      user: { companyId: 'A', businessUnitId: null },
    }));
    surveyFindFirst.mockResolvedValue({ id: 's-1', responses });

    const r = await caller().getResultsByArea({ surveyId: UUID, groupBy: 'company' });
    expect(r.suppressed).toBe(false);
    expect(r.results.length).toBe(1);
    expect(r.results[0]!.average).toBe(8);
    expect(r.results[0]!.responses).toBe(5);
  });
});
