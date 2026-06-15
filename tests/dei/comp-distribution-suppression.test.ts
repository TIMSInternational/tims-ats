import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral test for compensation distribution suppression (round 7) ──────────
// Round 7 (present-key cardinality) SUPERSEDES the round-5 uniform-flag-keep-keys
// approach. getCompaRatioDistribution (buckets) and getBandDistribution (bands) must:
//  emit an EMPTY distribution/bands (no per-bucket/band keys) when the OWN population
//  is 1..4 OR ANY bucket/band/unbanded bucket is below the floor — so N + the present-
//  key set can never pin singletons. The top-level `suppressed` flag is the only signal.

const compFindMany = vi.fn();
const compCount = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    employeeCompensation: {
      findMany: (...a: unknown[]) => compFindMany(...a),
      count: (...a: unknown[]) => compCount(...a),
    },
  },
}));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>(
    '../../packages/api/src/access',
  );
  return { ...actual, requireOrgScope: vi.fn(), assertScoped: vi.fn(), assertSubjectInScope: vi.fn(), scopeWhereFor: vi.fn(async () => ({})), logDataAccess: vi.fn(async () => undefined) };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: { roles: string[] } }>().create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { compensationRouter } from '../../packages/api/src/routers/compensation';

interface CompCaller {
  getCompaRatioDistribution(input?: unknown): Promise<{
    distribution: Record<string, { suppressed: boolean; count: number | null }>;
    totalEmployees: number | null;
    suppressed: boolean;
  }>;
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
const createCaller = t.createCallerFactory(compensationRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);
const caller = () => createCaller({ user: { organizationId: 'org-1', id: 'u-1' }, access: { roles: ['super_admin'] } }) as unknown as CompCaller;

const compRow = (cr: number) => ({ id: 'x', currentSalary: 5_000_000, compaRatio: cr, userId: 'u' });

beforeEach(() => vi.clearAllMocks());

describe('getCompaRatioDistribution suppression (round 7)', () => {
  it('N=6 with one sub-floor bucket → EMPTY distribution + null total + suppressed (no bucket keys)', async () => {
    // 5 employees at compaRatio 1.05 (bucket 1.00-1.10) + 1 at 0.85 (bucket 0.80-0.90, sub-floor).
    compFindMany.mockResolvedValue([
      compRow(1.05), compRow(1.05), compRow(1.05), compRow(1.05), compRow(1.05),
      compRow(0.85),
    ]);
    const r = await caller().getCompaRatioDistribution();
    // round 7: no bucket keys survive → N + present-key set cannot pin the singleton bucket.
    expect(Object.keys(r.distribution)).toEqual([]);
    expect(r.suppressed).toBe(true);
    expect(r.totalEmployees).toBeNull();
  });

  it('N=3 total → EMPTY distribution + null total (no bucket keys to pin values)', async () => {
    compFindMany.mockResolvedValue([compRow(1.05), compRow(0.85), compRow(0.95)]);
    const r = await caller().getCompaRatioDistribution();
    expect(Object.keys(r.distribution)).toEqual([]);
    expect(r.suppressed).toBe(true);
    expect(r.totalEmployees).toBeNull();
  });

  it('all buckets >= 5 → real counts, real total', async () => {
    const rows = [
      ...Array.from({ length: 5 }, () => compRow(1.05)), // 1.00-1.10
      ...Array.from({ length: 5 }, () => compRow(0.85)), // 0.80-0.90
    ];
    compFindMany.mockResolvedValue(rows);
    const r = await caller().getCompaRatioDistribution();
    expect(r.distribution['1.00-1.10']!.count).toBe(5);
    expect(r.distribution['0.80-0.90']!.count).toBe(5);
    expect(r.totalEmployees).toBe(10);
  });

  // ── round 13-14: positive-salary alignment + non-positive complement (compa-ratio) ──
  // 25 comp rows / 22 positive-salary / 3 zero-salary. totalEmployees must report the
  // positive-salary population (== compensatedEmployees), NOT 25, and the 3-row
  // non-positive complement (1..4) must trip suppression so `totalEmployees −
  // compensatedEmployees` can never recover the 3 bucket.
  const compRowSalary = (salary: number, cr: number) => ({ id: 'x', currentSalary: salary, compaRatio: cr, userId: 'u' });

  it('25 / 22 positive / 3 zero-salary → suppressed + null total (non-positive complement = 3, 25 never returned)', async () => {
    compFindMany.mockResolvedValue([
      ...Array.from({ length: 22 }, () => compRowSalary(5_000_000, 1.05)), // bucket 1.00-1.10
      ...Array.from({ length: 3 }, () => compRowSalary(0, 0)), // 3 zero-salary (non-positive bucket)
    ]);
    const r = await caller().getCompaRatioDistribution();
    expect(r.suppressed).toBe(true);
    expect(r.totalEmployees).toBeNull();
    expect(r.totalEmployees).not.toBe(25);
    expect(Object.keys(r.distribution)).toEqual([]);
  });

  it('27 / 22 positive / 5 zero-salary → totalEmployees == 22 (positive population), never 27', async () => {
    compFindMany.mockResolvedValue([
      ...Array.from({ length: 22 }, () => compRowSalary(5_000_000, 1.05)),
      ...Array.from({ length: 5 }, () => compRowSalary(0, 0)), // non-positive bucket = 5 (clears floor)
    ]);
    const r = await caller().getCompaRatioDistribution();
    // totalEmployees is the canonical positive-salary count (22), aligned to
    // compensatedEmployees — NOT the all-rows count (27). Subtraction yields 0, not 5.
    expect(r.totalEmployees).toBe(22);
    expect(r.suppressed).toBe(false);
    expect(r.distribution['1.00-1.10']!.count).toBe(22);
  });
});

describe('getBandDistribution suppression (round 7)', () => {
  const band = (id: string) => ({ id, level: 'L' + id, title: 'T' + id, minSalary: 4_000_000, midSalary: 5_000_000, maxSalary: 6_000_000 });
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
  const makeRow = (salary: number, variable = 0) => ({ currentSalary: salary, variablePay: variable });

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
    compFindMany.mockResolvedValue([
      ...Array.from({ length: 5 }, () => makeRow(5_000_000, 500_000)),
      makeRow(0),
    ]);
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
