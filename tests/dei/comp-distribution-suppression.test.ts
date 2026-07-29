import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral test for compensation distribution suppression (round 7) ──────────
// Round 7 (present-key cardinality) SUPERSEDES the round-5 uniform-flag-keep-keys
// approach. getBandDistribution (bands) must emit an EMPTY bands array (no per-band
// keys) when the OWN population is 1..4 OR ANY band/unbanded bucket is below the floor
// — so N + the present-key set can never pin singletons. The top-level `suppressed`
// flag is the only signal. (getCompaRatioDistribution carried the identical guarantee;
// its TS procedure was deleted 2026-07-29 — the kernel-level guard is still covered by
// tests/compensation/compa-ratio-distribution-fixtures.test.ts + the C# unit tests.)

const compFindMany = vi.fn();
const compCount = vi.fn();
const companyFindFirst = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    company: { findFirst: (...a: unknown[]) => companyFindFirst(...a) },
    employeeCompensation: {
      findMany: (...a: unknown[]) => compFindMany(...a),
      count: (...a: unknown[]) => compCount(...a),
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
  const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: { roles: string[] } }>().create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { compensationRouter } from '../../packages/api/src/routers/compensation';

interface CompCaller {
  getBandDistribution(): Promise<Array<{ level: string; dots: unknown[]; suppressed: boolean }>>;
  getTotalCompBreakdown(input?: unknown): Promise<{
    totalComp: number | null;
    breakdown: {
      baseSalary: { total: number | null; percentage: number | null };
      variablePay: { total: number | null; percentage: number | null };
    };
    employeeCount: number | null;
    suppressed: boolean;
  }>;
  getDashboardKpis(): Promise<{
    compensatedEmployees: number | null;
    compensatedSuppressed: boolean;
    totalMonthlyPayroll: number | null;
    avgSalary: number | null;
    activeEmployees: number;
    pendingAdjustments: number | null;
    pendingAdjustmentsSuppressed: boolean;
    benefitsUtilizationPct: number;
    avgCompaRatio: number | null;
  }>;
}

const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: { roles: string[] } }>().create();
const createCaller = t.createCallerFactory(
  compensationRouter as unknown as Parameters<typeof t.createCallerFactory>[0],
);
const caller = () =>
  createCaller({
    user: { organizationId: 'org-1', id: 'u-1' },
    access: { roles: ['super_admin'] },
  }) as unknown as CompCaller;

beforeEach(() => {
  vi.clearAllMocks();
  companyFindFirst.mockResolvedValue({ currency: 'USD' });
});

describe('getBandDistribution suppression (round 7)', () => {
  const band = (id: string) => ({
    id,
    level: 'L' + id,
    title: 'T' + id,
    minSalary: 4_000_000,
    midSalary: 5_000_000,
    maxSalary: 6_000_000,
  });
  const banded = (bandId: string) => ({ currentSalary: 5_000_000, band: band(bandId) });

  it('one sub-floor band → EMPTY bands array (no band keys to pin)', async () => {
    // band A: 5 employees, band B: 3 employees (sub-floor). unbanded count = 0.
    // Round 7: emit NO band keys — N + the band-key set can never pin the singleton band.
    compFindMany.mockResolvedValue([
      ...Array.from({ length: 5 }, () => banded('A')),
      ...Array.from({ length: 3 }, () => banded('B')),
    ]);
    compCount.mockResolvedValue(0); // unbanded
    const r = await caller().getBandDistribution();
    expect(r).toEqual([]);
  });

  it('total banded+unbanded population 1..4 → EMPTY bands array', async () => {
    compFindMany.mockResolvedValue([banded('A'), banded('A')]); // 2 banded
    compCount.mockResolvedValue(1); // 1 unbanded → total 3
    const r = await caller().getBandDistribution();
    expect(r).toEqual([]);
  });

  it('all bands >= 5, total >= 5 → real dots, no suppression', async () => {
    compFindMany.mockResolvedValue(Array.from({ length: 6 }, () => banded('A')));
    compCount.mockResolvedValue(0);
    const r = await caller().getBandDistribution();
    expect(r[0]!.suppressed).toBe(false);
    expect(r[0]!.dots.length).toBe(6);
  });

  // ── round 13-14: positive-salary alignment + non-positive complement (band) ──
  // 25 banded comp rows / 22 positive-salary / 3 zero-salary. Σ dots must equal the
  // positive-salary population (== compensatedEmployees), NOT 25, and the 3-row
  // non-positive complement (1..4) must trip the all-or-nothing suppression so the
  // distribution is empty (Σ dots can never be subtracted to recover the 3 bucket).
  it('25 banded / 22 positive / 3 zero-salary → EMPTY bands (non-positive complement = 3 suppresses; Σ dots not recoverable as 25)', async () => {
    const bandedZero = (bandId: string) => ({ currentSalary: 0, band: band(bandId) });
    compFindMany.mockResolvedValue([
      ...Array.from({ length: 22 }, () => banded('A')),
      ...Array.from({ length: 3 }, () => bandedZero('A')),
    ]);
    compCount.mockResolvedValue(0); // no unbanded
    const r = await caller().getBandDistribution();
    // non-positive bucket = 3 (1..4) → all-or-nothing fires → empty bands, no Σ dots to leak.
    expect(r).toEqual([]);
  });

  it('27 banded / 22 positive / 5 zero-salary → real dots; Σ dots == 22 (positive-salary), never 27', async () => {
    const bandedZero = (bandId: string) => ({ currentSalary: 0, band: band(bandId) });
    compFindMany.mockResolvedValue([
      ...Array.from({ length: 22 }, () => banded('A')),
      ...Array.from({ length: 5 }, () => bandedZero('A')), // non-positive bucket = 5 (clears floor)
    ]);
    compCount.mockResolvedValue(0);
    const r = await caller().getBandDistribution();
    const totalDots = r.reduce((sum, b) => sum + b.dots.length, 0);
    // Σ dots is the canonical positive-salary count (22), aligned to compensatedEmployees —
    // NOT the all-rows count (27). Subtracting positive(22) from Σ dots(22) yields 0, not 5.
    expect(totalDots).toBe(22);
  });
});

// ── getTotalCompBreakdown: denominator alignment + complementary-bucket guard (round 13) ──
// The cross-endpoint subtraction attack:
//   getTotalCompBreakdown.employeeCount  = allRows           (e.g. 9)
//   getDashboardKpis.compensatedEmployees = positiveRows      (e.g. 5)
//   attacker computes: 9 − 5 = 4  →  recovers the non-positive-salary bucket (1..4)
//
// Fix verifications:
// (A) getTotalCompBreakdown NEVER returns an all-rows count of 9 when there are 4 non-
//     positive-salary rows (either the endpoint suppresses OR employeeCount == 5, not 9).
// (B) When the non-positive bucket is 1..4 the endpoint suppresses entirely (null totals).
// (C) When all rows have positive salary, employeeCount == baseContributors (no hidden bucket).
describe('getTotalCompBreakdown — denominator alignment + complementary-bucket guard (round 13)', () => {
  const makeRow = (salary: number, variable = 0) => ({ currentSalary: salary, variablePay: variable, currency: 'USD' });

  it('(A) 5 positive-salary + 4 zero-salary rows → suppressed (non-positive bucket = 4, 1..4 trigger)', async () => {
    // 4 zero-salary rows → nonPositiveContributors = 4 → 1..4 → suppresses.
    // The all-rows count of 9 is NEVER returned; employeeCount is null.
    compFindMany.mockResolvedValue([
      ...Array.from({ length: 5 }, () => makeRow(5_000_000)),
      ...Array.from({ length: 4 }, () => makeRow(0)),
    ]);
    const r = await caller().getTotalCompBreakdown();
    expect(r.suppressed).toBe(true);
    expect(r.employeeCount).toBeNull();
    // Ensure the all-rows count (9) is NOT returned — the oracle is closed.
    expect(r.employeeCount).not.toBe(9);
  });

  it('(B) 5 positive + 1 zero row → NOT suppressed, employeeCount == 5 (positive population, not 6)', async () => {
    // nonPositiveContributors = 1 → 1..4 → suppresses entirely.
    // Wait — 1 non-positive triggers the complementary-bucket. Suppressed.
    compFindMany.mockResolvedValue([...Array.from({ length: 5 }, () => makeRow(5_000_000, 500_000)), makeRow(0)]);
    const r = await caller().getTotalCompBreakdown();
    // Non-positive bucket = 1 → 1..4 → whole endpoint suppresses.
    expect(r.suppressed).toBe(true);
    expect(r.employeeCount).toBeNull();
  });

  it('(C) all 6 rows have positive salary → NOT suppressed, employeeCount == 6 (no hidden bucket)', async () => {
    // nonPositiveContributors = 0 → passes (0 is not 1..4). All positive.
    // employeeCount must equal baseContributors = 6, never a different definition.
    compFindMany.mockResolvedValue(Array.from({ length: 6 }, () => makeRow(5_000_000, 500_000)));
    const r = await caller().getTotalCompBreakdown();
    expect(r.suppressed).toBe(false);
    expect(r.employeeCount).toBe(6); // positiveRows = 6, aligned with compensatedEmployees
    expect(r.totalComp).not.toBeNull();
  });

  it('(D) 0 rows → not suppressed, employeeCount == 0 (empty population, no individual revealed)', async () => {
    compFindMany.mockResolvedValue([]);
    const r = await caller().getTotalCompBreakdown();
    expect(r.suppressed).toBe(false);
    expect(r.employeeCount).toBe(0);
    expect(r.totalComp).toBe(0);
  });
});
