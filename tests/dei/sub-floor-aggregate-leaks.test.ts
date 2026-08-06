import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral tests for round-6 sub-floor aggregate leaks (slice 6) ─────────
// Closes the dashboard/summary endpoints that returned a salary/demographic/
// engagement count/sum/avg/ratio computed over a 1..4-person population without a
// min-5 floor. Covers:
//   HIGH 4  nationality/ethnicity sort  → order independent of hidden counts
//   (MEDIUM 5 simulateAdjustment select — REMOVED 2026-08-05 (#59): the whole compensation router was
//    TS-deleted. See the in-place note further down for where that guarantee now lives.)
//   MEDIUM 6 dei getDashboardKpis       → totalNationalities null when distribution hidden
//   MEDIUM 7 getSurveyResults           → uniform-suppress every question summary
//   (finding 5 getClimateHeatmap category-contributor floor, MEDIUM 8 engagement
//    getDashboardKpis totalResponses floor — both REMOVED 2026-07-31: their TS procedures were
//    deleted, NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod. The underlying min-5
//    guards still live in the shared @tims/shared kernels (buildClimateHeatmap /
//    buildEngagementKpis), covered by tests/engagement/kernels-fixtures.test.ts's golden-fixture
//    parity + services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/
//    EngagementReadEndpointTests.cs on the C# side.
//   HIGH 2 getTotalCompBreakdown / HIGH 3 compensation getDashboardKpis — ALSO REMOVED (same day,
//    same pass): their TS procedures were deleted once NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP
//    was confirmed permanently live. The underlying min-5 guards still live in the shared
//    @tims/shared kernels (buildTotalCompBreakdown / buildCompDashboardKpis), covered by
//    tests/compensation/comp-fx-shaping-fixtures.test.ts's golden-fixture parity + the C# port's
//    own CompensationFxShapingKernelsFixtureTests.cs.)
//
// Engagement resolvers live inline in the router behind the full middleware stack — we mock
// `../trpc` so permissionProcedure is a bare pass-through, mock `@tims/db` (tenantDb), no-op the
// scope/audit helpers, and keep the REAL suppressBelowMin5/selectFor so the access logic is
// exercised end-to-end.

// ─────────────────────────────────────────────────────────────────────────────
// Shared @tims/db + access + trpc mocks (engagement router)
// ─────────────────────────────────────────────────────────────────────────────
const surveyFindFirst = vi.fn();
const surveyFindMany = vi.fn();
const surveyCount = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    survey: {
      findFirst: (...a: unknown[]) => surveyFindFirst(...a),
      findMany: (...a: unknown[]) => surveyFindMany(...a),
      count: (...a: unknown[]) => surveyCount(...a),
    },
  },
}));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return {
    ...actual,
    requireOrgScope: vi.fn(),
    assertScoped: vi.fn(),
    assertSubjectInScope: vi.fn(),
    scopeWhereFor: vi.fn(async () => ({})),
    logDataAccess: vi.fn(async () => undefined),
  };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{
      user: { organizationId: string; id: string; impersonatorId?: string };
      access: { roles: string[] };
      headers: Headers;
    }>()
    .create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { engagementRouter } from '../../packages/api/src/routers/engagement';

const t = initTRPC
  .context<{
    user: { organizationId: string; id: string; impersonatorId?: string };
    access: { roles: string[] };
    headers: Headers;
  }>()
  .create();

const engFactory = t.createCallerFactory(engagementRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

const engCaller = () =>
  engFactory({
    user: { organizationId: 'org-1', id: 'u-1' },
    access: { roles: ['super_admin'] },
    headers: new Headers(),
  }) as unknown as {
    getSurveyResults(input: { surveyId: string }): Promise<{
      totalResponses: number | null;
      suppressed: boolean;
      questionSummaries: Array<{
        question: unknown;
        count: number | null;
        average?: number | null;
        suppressed: boolean;
      }>;
    }>;
    // getDashboardKpis / getClimateHeatmap REMOVED from this caller type 2026-07-31 — their TS
    // procedures were deleted (see the file header note).
    listSurveys(input?: unknown): Promise<{
      items: Array<{ id: string; responseCount: number | null; responseCountSuppressed: boolean }>;
      total: number;
    }>;
  };

beforeEach(() => {
  vi.clearAllMocks();
});

// HIGH 2 (getTotalCompBreakdown) / HIGH 3 (compensation getDashboardKpis) min-5-floor behavioral
// tests REMOVED 2026-07-31 — see the file header note.

// round 7 finding 5 (getClimateHeatmap per-category distinct-respondent floor) REMOVED 2026-07-31
// — see the file header note.

// ── round 7 finding 6: listSurveys responseCount floored ─────────────────────
describe('listSurveys responseCount floor (finding 6)', () => {
  const surveyRow = (responseCount: number) => ({
    id: 's-1',
    title: 'Pulse',
    type: 'pulse',
    status: 'active',
    startsAt: null,
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    responseCount,
  });

  it('3-response survey → responseCount null + responseCountSuppressed true', async () => {
    surveyFindMany.mockResolvedValue([surveyRow(3)]);
    surveyCount.mockResolvedValue(1);
    const r = await engCaller().listSurveys();
    expect(r.items[0]!.responseCount).toBeNull();
    expect(r.items[0]!.responseCountSuppressed).toBe(true);
  });

  it('40-response survey → real responseCount, not suppressed', async () => {
    surveyFindMany.mockResolvedValue([surveyRow(40)]);
    surveyCount.mockResolvedValue(1);
    const r = await engCaller().listSurveys();
    expect(r.items[0]!.responseCount).toBe(40);
    expect(r.items[0]!.responseCountSuppressed).toBe(false);
  });

  it('the explicit select OMITS no-longer-raw scalars but selects responseCount for flooring', async () => {
    surveyFindMany.mockResolvedValue([surveyRow(0)]);
    surveyCount.mockResolvedValue(1);
    await engCaller().listSurveys();
    const sel = (surveyFindMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    // explicit select present (no bare findMany) and responseCount selected for flooring.
    expect(sel).toBeDefined();
    expect(sel.responseCount).toBe(true);
    expect(sel.title).toBe(true);
  });
});

// MEDIUM 5 (simulateAdjustment's selectFor-derived Prisma select) REMOVED 2026-08-05 (#59): the
// compensation router was deleted outright — getPayEquity/simulateAdjustment/getMarketComparison/
// getEmployeeComp were all zero-FE-consumer dead code with live C# equivalents. The
// "compaRatio/bandId never LEAVE the DB for an unentitled caller" guarantee is now asserted on the C#
// side by services/Tims.Platform/tests/Tims.UnitTests/FxReads/CompensationFxReadUseCaseTests.cs:72
// (`Simulate_omits_the_compaRatio_block_for_a_non_entitled_caller`) and :90 (the entitled case).
// tests/dei/comp-field-auth.test.ts — which covered the same ground for getEmployeeComp AND
// simulateAdjustment — was deleted in the same pass; its employee-read counterpart is
// services/Tims.Platform/tests/Tims.IntegrationTests/Compensation/CompensationReadTests.cs:131,144.

// ── MEDIUM 7 → round 9: getSurveyResults all-or-nothing on contributor + skip ──
// Round 9 SUPERSEDES the round-6 uniform-keep-keys design: when ANY question's
// contributor OR skip bucket is sub-floor, the whole per-question breakdown is EMPTY
// (no per-question keys) + suppressed:true — consistent with the distributions'
// empty-when-suppressed rule. (Returning the real contributor count alongside
// totalResponses also let totalResponses − count recover a 1..4 skip bucket.)
describe('getSurveyResults all-or-nothing question suppression (MEDIUM 7 / round 9)', () => {
  it('N=6 with one sparse question (skip bucket 4) → empty questionSummaries + suppressed', async () => {
    // 6 respondents answer q1 (scale); only 2 answer q2 (contributor 2 → sub-floor;
    // and its skip bucket = 6 − 2 = 4 is also sub-floor).
    const responses = [
      { answers: { q1: 5, q2: 4 } },
      { answers: { q1: 5, q2: 4 } },
      { answers: { q1: 5 } },
      { answers: { q1: 5 } },
      { answers: { q1: 5 } },
      { answers: { q1: 5 } },
    ];
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      title: 'Pulse',
      questions: [
        { text: 'q1', type: 'scale' },
        { text: 'q2', type: 'scale' },
      ],
      responses,
    });
    const r = await engCaller().getSurveyResults({ surveyId: '22222222-2222-4222-8222-222222222222' });
    // round 9: a sub-floor contributor/skip bucket suppresses the whole per-question
    // breakdown — empty array (no keys) so q1 (6) is neither distinguishable from the
    // sparse q2 (2) nor recoverable via totalResponses − count.
    expect(r.suppressed).toBe(true);
    expect(r.questionSummaries).toEqual([]);
  });

  it('all questions >= 5 answers → real per-question counts, none suppressed', async () => {
    const responses = Array.from({ length: 6 }, () => ({ answers: { q1: 5, q2: 4 } }));
    surveyFindFirst.mockResolvedValue({
      id: 's-1',
      title: 'Pulse',
      questions: [
        { text: 'q1', type: 'scale' },
        { text: 'q2', type: 'scale' },
      ],
      responses,
    });
    const r = await engCaller().getSurveyResults({ surveyId: '22222222-2222-4222-8222-222222222222' });
    expect(r.questionSummaries.every((q) => q.suppressed === false)).toBe(true);
    expect(r.questionSummaries.find((q) => q.question === 'q1')!.count).toBe(6);
  });
});

// MEDIUM 8 (engagement getDashboardKpis totalResponses floor) REMOVED 2026-07-31 — see the file
// header note.
