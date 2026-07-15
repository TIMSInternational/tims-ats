import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral tests for round-6 sub-floor aggregate leaks (slice 6) ─────────
// Closes the dashboard/summary endpoints that returned a salary/demographic/
// engagement count/sum/avg/ratio computed over a 1..4-person population without a
// min-5 floor. Covers:
//   HIGH 1  getCompaRatioDistribution  → avgCompaRatio null at sub-floor population
//   HIGH 2  getTotalCompBreakdown      → totals + employeeCount null + suppressed
//   HIGH 3  compensation getDashboardKpis → payroll/avgSalary/compensated/avgCompaRatio
//   HIGH 4  nationality/ethnicity sort  → order independent of hidden counts
//   MEDIUM 5 simulateAdjustment select  → omits compaRatio/bandId for leader/employee
//   MEDIUM 6 dei getDashboardKpis       → totalNationalities null when distribution hidden
//   MEDIUM 7 getSurveyResults           → uniform-suppress every question summary
//   MEDIUM 8 engagement getDashboardKpis → totalResponses min-5 floored
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
const surveyResponseCount = vi.fn();
const surveyResponseGroupBy = vi.fn();
const actionPlanCount = vi.fn();

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
    surveyResponse: {
      count: (...a: unknown[]) => surveyResponseCount(...a),
      groupBy: (...a: unknown[]) => surveyResponseGroupBy(...a),
    },
    actionPlan: { count: (...a: unknown[]) => actionPlanCount(...a) },
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
    logDataAccess: vi.fn(async () => undefined),
  };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { organizationId: string; id: string; impersonatorId?: string }; access: { roles: string[] }; headers: Headers }>()
    .create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { compensationRouter } from '../../packages/api/src/routers/compensation';
import { engagementRouter } from '../../packages/api/src/routers/engagement';

const t = initTRPC
  .context<{ user: { organizationId: string; id: string; impersonatorId?: string }; access: { roles: string[] }; headers: Headers }>()
  .create();

const compFactory = t.createCallerFactory(compensationRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);
const engFactory = t.createCallerFactory(engagementRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

const compCaller = (roles: string[] = ['super_admin']) =>
  compFactory({ user: { organizationId: 'org-1', id: 'u-1' }, access: { roles }, headers: new Headers() }) as unknown as {
    getCompaRatioDistribution(input?: unknown): Promise<{ distribution: Record<string, unknown>; avgCompaRatio: number | null; totalEmployees: number | null; suppressed: boolean }>;
    getTotalCompBreakdown(input?: unknown): Promise<{ totalComp: number | null; employeeCount: number | null; suppressed: boolean; breakdown: { baseSalary: { total: number | null; percentage: number | null }; variablePay: { total: number | null; percentage: number | null } } }>;
    getDashboardKpis(): Promise<{ totalMonthlyPayroll: number | null; avgSalary: number | null; compensatedEmployees: number | null; compensatedSuppressed: boolean; avgCompaRatio: number | null; activeEmployees: number; pendingAdjustments: number | null; pendingAdjustmentsSuppressed: boolean }>;
    simulateAdjustment(input: { userId: string; proposedSalary: number }): Promise<Record<string, unknown>>;
  };

const engCaller = () =>
  engFactory({ user: { organizationId: 'org-1', id: 'u-1' }, access: { roles: ['super_admin'] }, headers: new Headers() }) as unknown as {
    getSurveyResults(input: { surveyId: string }): Promise<{ totalResponses: number | null; suppressed: boolean; questionSummaries: Array<{ question: unknown; count: number | null; average?: number | null; suppressed: boolean }> }>;
    getDashboardKpis(): Promise<{ totalResponses: number | null; totalResponsesSuppressed: boolean; activeSurveys: number; actionPlansOpen: number }>;
    getClimateHeatmap(input?: unknown): Promise<{ surveyId: string | null; title: string; suppressed: boolean; data: Array<{ category: string; score: number | null }> }>;
    listSurveys(input?: unknown): Promise<{ items: Array<{ id: string; responseCount: number | null; responseCountSuppressed: boolean }>; total: number }>;
  };

const compRow = (cr: number) => ({ id: 'x', currentSalary: 5_000_000, currency: 'USD', compaRatio: cr, userId: 'u' });

beforeEach(() => {
  vi.clearAllMocks();
  companyFindFirst.mockResolvedValue({ currency: 'USD' });
});

// ── HIGH 1: getCompaRatioDistribution avgCompaRatio null at sub-floor ─────────
describe('getCompaRatioDistribution avgCompaRatio (HIGH 1)', () => {
  it('N=3 → distribution empty, totalEmployees null, avgCompaRatio null', async () => {
    compFindMany.mockResolvedValue([compRow(1.05), compRow(0.85), compRow(0.95)]);
    const r = await compCaller().getCompaRatioDistribution();
    expect(Object.keys(r.distribution)).toEqual([]);
    expect(r.totalEmployees).toBeNull();
    // avgCompaRatio is a MEAN over the same 1..4 population → must be null, not a number.
    expect(r.avgCompaRatio).toBeNull();
  });

  it('population >= 5 → avgCompaRatio is a real number', async () => {
    compFindMany.mockResolvedValue(Array.from({ length: 6 }, () => compRow(1.0)));
    const r = await compCaller().getCompaRatioDistribution();
    expect(r.avgCompaRatio).toBe(1.0);
  });

  // round 7 finding 1: avgCompaRatio is the mean of the NON-NULL compaRatio values, a
  // smaller sub-population than all comp rows. >=5 comp rows but only 1..4 ratio
  // contributors → avgCompaRatio must be null (that mean is individual-level data),
  // even though the distribution itself clears the comp-population floor.
  it('>=5 comp rows but 1..4 non-null ratio contributors → avgCompaRatio null', async () => {
    // 8 rows, but only 3 have a non-null/non-zero compaRatio (5 have compaRatio 0).
    compFindMany.mockResolvedValue([
      compRow(1.05), compRow(0.95), compRow(1.1),
      compRow(0), compRow(0), compRow(0), compRow(0), compRow(0),
    ]);
    const r = await compCaller().getCompaRatioDistribution();
    expect(r.avgCompaRatio).toBeNull();
    // 5 of the 8 rows land in the >1.20-or-on-target buckets? No: cr=0 → bucket '<0.80'
    // (5 rows, clears floor); the 3 nonzero land in their buckets (each 1..4) → ANY
    // bucket sub-floor → distribution empties too.
    expect(Object.keys(r.distribution)).toEqual([]);
    expect(r.suppressed).toBe(true);
  });
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
      row(5_000_000, 1_000_000), row(5_000_000, 1_000_000),
      row(5_000_000, 0), row(5_000_000, 0), row(5_000_000, 0), row(5_000_000, 0),
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

// ── round 7 finding 5: getClimateHeatmap per-category distinct-respondent floor ──
describe('getClimateHeatmap category contributor floor (finding 5)', () => {
  const survey = (responses: Array<{ answers: Record<string, number> }>) => ({
    id: 's-1',
    title: 'Climate',
    questions: [
      { text: 'q1', type: 'scale', category: 'wellbeing' },
      { text: 'q2', type: 'scale', category: 'growth' },
    ],
    responses,
  });

  it('10-response survey, one category answered by only 1 person → category scores suppressed', async () => {
    // All 10 answer q1 (wellbeing); only 1 answers q2 (growth) → growth has 1 contributor.
    const responses = [
      { answers: { q1: 5, q2: 4 } },
      ...Array.from({ length: 9 }, () => ({ answers: { q1: 5 } })),
    ];
    surveyFindMany.mockResolvedValue([survey(responses)]);
    const r = await engCaller().getClimateHeatmap();
    // uniform suppression: every category score null + suppressed:true.
    expect(r.suppressed).toBe(true);
    expect(r.data.every((d) => d.score === null)).toBe(true);
  });

  it('all categories answered by >= 5 people → real category scores', async () => {
    const responses = Array.from({ length: 6 }, () => ({ answers: { q1: 5, q2: 4 } }));
    surveyFindMany.mockResolvedValue([survey(responses)]);
    const r = await engCaller().getClimateHeatmap();
    expect(r.suppressed).toBe(false);
    expect(r.data.find((d) => d.category === 'wellbeing')!.score).toBe(5);
    expect(r.data.find((d) => d.category === 'growth')!.score).toBe(4);
  });
});

// ── round 7 finding 6: listSurveys responseCount floored ─────────────────────
describe('listSurveys responseCount floor (finding 6)', () => {
  const surveyRow = (responseCount: number) => ({
    id: 's-1', title: 'Pulse', type: 'pulse', status: 'active',
    startsAt: null, endsAt: null, createdAt: new Date(), updatedAt: new Date(),
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

// ── MEDIUM 8: engagement getDashboardKpis totalResponses floor ──────────────
describe('engagement getDashboardKpis totalResponses (MEDIUM 8)', () => {
  it('3 org-wide responses → totalResponses null + suppressed; surveys/plans stay', async () => {
    surveyCount.mockResolvedValue(1);
    surveyResponseCount.mockResolvedValue(3);
    surveyResponseGroupBy.mockResolvedValue([{ surveyId: 's1', _count: { _all: 3 } }]);
    actionPlanCount.mockResolvedValue(2);
    const r = await engCaller().getDashboardKpis();
    expect(r.totalResponses).toBeNull();
    expect(r.totalResponsesSuppressed).toBe(true);
    expect(r.activeSurveys).toBe(1);
    expect(r.actionPlansOpen).toBe(2);
  });

  it('>= 5 responses → real count (all surveys clear the floor)', async () => {
    surveyCount.mockResolvedValue(2);
    surveyResponseCount.mockResolvedValue(40);
    surveyResponseGroupBy.mockResolvedValue([
      { surveyId: 's1', _count: { _all: 25 } },
      { surveyId: 's2', _count: { _all: 15 } },
    ]);
    actionPlanCount.mockResolvedValue(0);
    const r = await engCaller().getDashboardKpis();
    expect(r.totalResponses).toBe(40);
    expect(r.totalResponsesSuppressed).toBe(false);
  });

  it('0 responses passes through (reveals no individual)', async () => {
    surveyCount.mockResolvedValue(0);
    surveyResponseCount.mockResolvedValue(0);
    surveyResponseGroupBy.mockResolvedValue([]);
    actionPlanCount.mockResolvedValue(0);
    const r = await engCaller().getDashboardKpis();
    expect(r.totalResponses).toBe(0);
    expect(r.totalResponsesSuppressed).toBe(false);
  });
});
