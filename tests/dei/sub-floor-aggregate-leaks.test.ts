import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral tests for round-6 sub-floor aggregate leaks (slice 6) ─────────
// Closes the dashboard/summary endpoints that returned a salary/demographic/
// engagement count/sum/avg/ratio computed over a 1..4-person population without a
// min-5 floor. Covers:
//   HIGH 2  getTotalCompBreakdown      → totals + employeeCount null + suppressed
//   HIGH 3  compensation getDashboardKpis → payroll/avgSalary/compensated/avgCompaRatio
//   HIGH 4  nationality/ethnicity sort  → order independent of hidden counts
//   MEDIUM 5 simulateAdjustment select  → omits compaRatio/bandId for leader/employee
//   MEDIUM 6 dei getDashboardKpis       → totalNationalities null when distribution hidden
//   MEDIUM 7 getSurveyResults           → uniform-suppress every question summary
//   (finding 5 getClimateHeatmap category-contributor floor, MEDIUM 8 engagement
//    getDashboardKpis totalResponses floor — both REMOVED 2026-07-31: their TS procedures were
//    deleted, NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod. The underlying min-5
//    guards still live in the shared @tims/shared kernels (buildClimateHeatmap /
//    buildEngagementKpis), covered by tests/engagement/kernels-fixtures.test.ts's golden-fixture
//    parity + services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/
//    EngagementReadEndpointTests.cs on the C# side.)
//
// Compensation/engagement resolvers live inline in the router behind the full
// middleware stack — we mock `../trpc` so permissionProcedure is a bare pass-through,
// mock `@tims/db` (tenantDb), no-op the scope/audit helpers, and keep the REAL
// suppressBelowMin5/selectFor so the access logic is exercised end-to-end.

// ─────────────────────────────────────────────────────────────────────────────
// Shared @tims/db + access + trpc mocks (compensation + engagement routers)
// ─────────────────────────────────────────────────────────────────────────────
const compFindMany = vi.fn();
const compCount = vi.fn();
const compAggregate = vi.fn();
const compFindFirst = vi.fn();
const bandFindUnique = vi.fn();
const salaryAdjustmentCount = vi.fn();
const userCount = vi.fn();
const companyFindFirst = vi.fn();
const benefitPlanFindMany = vi.fn();
const surveyFindFirst = vi.fn();
const surveyFindMany = vi.fn();
const surveyCount = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    employeeCompensation: {
      findMany: (...a: unknown[]) => compFindMany(...a),
      count: (...a: unknown[]) => compCount(...a),
      aggregate: (...a: unknown[]) => compAggregate(...a),
      findFirst: (...a: unknown[]) => compFindFirst(...a),
    },
    salaryBand: { findUnique: (...a: unknown[]) => bandFindUnique(...a) },
    salaryAdjustment: { count: (...a: unknown[]) => salaryAdjustmentCount(...a) },
    user: { count: (...a: unknown[]) => userCount(...a) },
    company: { findFirst: (...a: unknown[]) => companyFindFirst(...a) },
    benefitPlan: { findMany: (...a: unknown[]) => benefitPlanFindMany(...a) },
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

import { compensationRouter } from '../../packages/api/src/routers/compensation';
import { engagementRouter } from '../../packages/api/src/routers/engagement';

const t = initTRPC
  .context<{
    user: { organizationId: string; id: string; impersonatorId?: string };
    access: { roles: string[] };
    headers: Headers;
  }>()
  .create();

const compFactory = t.createCallerFactory(compensationRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);
const engFactory = t.createCallerFactory(engagementRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

const compCaller = (roles: string[] = ['super_admin']) =>
  compFactory({
    user: { organizationId: 'org-1', id: 'u-1' },
    access: { roles },
    headers: new Headers(),
  }) as unknown as {
    getTotalCompBreakdown(input?: unknown): Promise<{
      totalComp: number | null;
      employeeCount: number | null;
      suppressed: boolean;
      breakdown: {
        baseSalary: { total: number | null; percentage: number | null };
        variablePay: { total: number | null; percentage: number | null };
      };
    }>;
    getDashboardKpis(): Promise<{
      totalMonthlyPayroll: number | null;
      avgSalary: number | null;
      compensatedEmployees: number | null;
      compensatedSuppressed: boolean;
      avgCompaRatio: number | null;
      activeEmployees: number;
      pendingAdjustments: number | null;
      pendingAdjustmentsSuppressed: boolean;
    }>;
    simulateAdjustment(input: { userId: string; proposedSalary: number }): Promise<Record<string, unknown>>;
  };

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
  companyFindFirst.mockResolvedValue({ currency: 'USD' });
});

// ── HIGH 2: getTotalCompBreakdown min-5 floor ────────────────────────────────
describe('getTotalCompBreakdown (HIGH 2)', () => {
  const row = (base: number, variable: number) => ({ currentSalary: base, variablePay: variable });

  it('N=3 → totalComp/base/variable/employeeCount null + suppressed', async () => {
    compFindMany.mockResolvedValue([row(5_000_000, 1_000_000), row(4_000_000, 0), row(6_000_000, 500_000)]);
    const r = await compCaller().getTotalCompBreakdown();
    expect(r.suppressed).toBe(true);
    expect(r.totalComp).toBeNull();
    expect(r.employeeCount).toBeNull();
    expect(r.breakdown.baseSalary.total).toBeNull();
    expect(r.breakdown.variablePay.total).toBeNull();
    expect(r.breakdown.baseSalary.percentage).toBeNull();
  });

  it('population >= 5 but a sub-floor variablePay-contributor set still suppresses', async () => {
    // 6 base contributors, but only 2 have nonzero variablePay → variable sum is sub-floor.
    compFindMany.mockResolvedValue([
      row(5_000_000, 1_000_000),
      row(5_000_000, 1_000_000),
      row(5_000_000, 0),
      row(5_000_000, 0),
      row(5_000_000, 0),
      row(5_000_000, 0),
    ]);
    const r = await compCaller().getTotalCompBreakdown();
    expect(r.suppressed).toBe(true);
    expect(r.totalComp).toBeNull();
  });

  it('all contributor populations >= 5 → real sums', async () => {
    compFindMany.mockResolvedValue(Array.from({ length: 6 }, () => row(5_000_000, 1_000_000)));
    const r = await compCaller().getTotalCompBreakdown();
    expect(r.suppressed).toBe(false);
    expect(r.totalComp).toBe(6 * 6_000_000);
    expect(r.employeeCount).toBe(6);
  });

  it('empty population passes through as real zeros (no individual)', async () => {
    compFindMany.mockResolvedValue([]);
    const r = await compCaller().getTotalCompBreakdown();
    expect(r.suppressed).toBe(false);
    expect(r.totalComp).toBe(0);
    expect(r.employeeCount).toBe(0);
  });
});

// ── HIGH 3: compensation getDashboardKpis min-5 floor ────────────────────────
describe('compensation getDashboardKpis (HIGH 3)', () => {
  const stubSecondary = () => {
    salaryAdjustmentCount.mockResolvedValue(0);
    userCount.mockResolvedValue(50);
    benefitPlanFindMany.mockResolvedValue([]);
  };

  it('compensated population 1..4 → payroll/avgSalary/compensatedEmployees null', async () => {
    stubSecondary();
    // aggregate (payroll) + count (compensated) + aggregate (compaRatio) + count (compaRatio)
    compAggregate
      .mockResolvedValueOnce({ _sum: { currentSalary: 12_000_000 }, _avg: { currentSalary: 4_000_000 } }) // payroll
      .mockResolvedValueOnce({ _avg: { compaRatio: 1.02 } }); // compaRatio
    compCount
      .mockResolvedValueOnce(3) // compensated population (sub-floor)
      .mockResolvedValueOnce(3); // compaRatio population (sub-floor)
    const r = await compCaller().getDashboardKpis();
    expect(r.totalMonthlyPayroll).toBeNull();
    expect(r.avgSalary).toBeNull();
    expect(r.compensatedEmployees).toBeNull();
    expect(r.compensatedSuppressed).toBe(true);
    expect(r.avgCompaRatio).toBeNull(); // compaRatio population also sub-floor
    expect(r.activeEmployees).toBe(50); // org headcount stays
  });

  it('compensated >=5 but compaRatio population <5 → only avgCompaRatio null', async () => {
    stubSecondary();
    compFindMany.mockResolvedValue(Array.from({ length: 10 }, () => ({ currentSalary: 5_000_000, currency: 'USD' })));
    compAggregate.mockResolvedValueOnce({ _avg: { compaRatio: 1.02 } });
    compCount
      .mockResolvedValueOnce(10) // compensated population clears floor
      .mockResolvedValueOnce(3); // only 3 compaRatio rows → sub-floor
    const r = await compCaller().getDashboardKpis();
    expect(r.totalMonthlyPayroll).toBe(50_000_000);
    expect(r.avgSalary).toBe(5_000_000);
    expect(r.compensatedEmployees).toBe(10);
    expect(r.avgCompaRatio).toBeNull();
  });

  it('all populations >= 5 → real values', async () => {
    stubSecondary();
    compFindMany.mockResolvedValue(Array.from({ length: 10 }, () => ({ currentSalary: 5_000_000, currency: 'USD' })));
    compAggregate.mockResolvedValueOnce({ _avg: { compaRatio: 1.02 } });
    compCount.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    const r = await compCaller().getDashboardKpis();
    expect(r.totalMonthlyPayroll).toBe(50_000_000);
    expect(r.avgCompaRatio).toBe(1.02);
    expect(r.compensatedSuppressed).toBe(false);
  });

  // round 7 finding 7: pendingAdjustments is a raw count over SalaryAdjustment
  // (restricted). 3 pending → null + suppressed flag (sub-floor disclosure).
  it('pendingAdjustments = 3 → null + pendingAdjustmentsSuppressed true', async () => {
    userCount.mockResolvedValue(50);
    benefitPlanFindMany.mockResolvedValue([]);
    salaryAdjustmentCount.mockResolvedValue(3); // sub-floor
    compAggregate
      .mockResolvedValueOnce({ _sum: { currentSalary: 50_000_000 }, _avg: { currentSalary: 5_000_000 } })
      .mockResolvedValueOnce({ _avg: { compaRatio: 1.02 } });
    compCount.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    const r = await compCaller().getDashboardKpis();
    expect(r.pendingAdjustments).toBeNull();
    expect(r.pendingAdjustmentsSuppressed).toBe(true);
  });

  it('pendingAdjustments = 7 → real count, not suppressed', async () => {
    userCount.mockResolvedValue(50);
    benefitPlanFindMany.mockResolvedValue([]);
    salaryAdjustmentCount.mockResolvedValue(7);
    compAggregate
      .mockResolvedValueOnce({ _sum: { currentSalary: 50_000_000 }, _avg: { currentSalary: 5_000_000 } })
      .mockResolvedValueOnce({ _avg: { compaRatio: 1.02 } });
    compCount.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    const r = await compCaller().getDashboardKpis();
    expect(r.pendingAdjustments).toBe(7);
    expect(r.pendingAdjustmentsSuppressed).toBe(false);
  });
});

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

// ── MEDIUM 5: simulateAdjustment Prisma select via selectFor ─────────────────
describe('simulateAdjustment select field-auth (MEDIUM 5)', () => {
  const TARGET_UUID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    compFindFirst.mockResolvedValue({ id: 'comp-1', currentSalary: 5_000_000 });
    bandFindUnique.mockResolvedValue({ minSalary: 4_000_000, midSalary: 5_000_000, maxSalary: 6_000_000 });
  });

  it('leader → the Prisma select OMITS compaRatio + bandId (never leaves the DB)', async () => {
    await compCaller(['leader']).simulateAdjustment({ userId: TARGET_UUID, proposedSalary: 5_500_000 });
    const sel = (compFindFirst.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    expect(sel.currentSalary).toBe(true);
    expect(sel.compaRatio).toBeUndefined();
    expect(sel.bandId).toBeUndefined();
    // the band lookup must not even run for an unentitled caller
    expect(bandFindUnique).not.toHaveBeenCalled();
  });

  it('employee → select omits compaRatio + bandId', async () => {
    await compCaller(['employee']).simulateAdjustment({ userId: TARGET_UUID, proposedSalary: 5_500_000 });
    const sel = (compFindFirst.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    expect(sel.compaRatio).toBeUndefined();
    expect(sel.bandId).toBeUndefined();
  });

  it('super_admin → select INCLUDES compaRatio + bandId', async () => {
    compFindFirst.mockResolvedValue({ id: 'comp-1', currentSalary: 5_000_000, compaRatio: 1.05, bandId: 'b-1' });
    await compCaller(['super_admin']).simulateAdjustment({ userId: TARGET_UUID, proposedSalary: 5_500_000 });
    const sel = (compFindFirst.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    expect(sel.compaRatio).toBe(true);
    expect(sel.bandId).toBe(true);
  });
});

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
