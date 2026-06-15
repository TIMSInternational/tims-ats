import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral tests for slice 6 round 8 monitoring sub-floor leaks ──────────
//   FIX 3  getExecutiveKpis.pendingAdjustments → null + suppressed flag at 1..4
//          (raw COUNT over the §21-restricted SalaryAdjustment population)
//   FIX 4  getCrossModuleTrend metric='engagement' → each monthly surveyResponse
//          count floored: null + suppressed per sub-floor point (no exact 1..4 leak)
//
// The monitoring resolvers live inline in the router behind the full middleware
// stack — mock `../trpc` so permissionProcedure is a bare pass-through, mock
// `@tims/db` (tenantDb), and keep the REAL suppressBelowMin5 so the floor is
// exercised end-to-end.

const userCount = vi.fn();
const vacancyCount = vi.fn();
const salaryAdjustmentCount = vi.fn();
const surveyCount = vi.fn();
const alertCount = vi.fn();
const surveyResponseCount = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    user: { count: (...a: unknown[]) => userCount(...a) },
    vacancy: { count: (...a: unknown[]) => vacancyCount(...a) },
    salaryAdjustment: { count: (...a: unknown[]) => salaryAdjustmentCount(...a) },
    survey: { count: (...a: unknown[]) => surveyCount(...a) },
    alert: {
      count: (...a: unknown[]) => alertCount(...a),
      groupBy: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    surveyResponse: { count: (...a: unknown[]) => surveyResponseCount(...a) },
    alertRule: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { organizationId: string; id: string }; access: { roles: string[] }; headers: Headers }>()
    .create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { monitoringRouter } from '../../packages/api/src/routers/monitoring';

const t = initTRPC
  .context<{ user: { organizationId: string; id: string }; access: { roles: string[] }; headers: Headers }>()
  .create();

const factory = t.createCallerFactory(monitoringRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

const caller = () =>
  factory({ user: { organizationId: 'org-1', id: 'u-1' }, access: { roles: ['hr_admin'] }, headers: new Headers() }) as unknown as {
    getExecutiveKpis(): Promise<{ pendingAdjustments: number | null; pendingAdjustmentsSuppressed: boolean; activeVacancies: number; activeSurveys: number; openAlerts: number; totalEmployees: number }>;
    getCrossModuleTrend(input: { metric: 'headcount' | 'turnover' | 'engagement' | 'alerts'; period?: '6m' | '12m' | '24m' }): Promise<{ metric: string; data: Array<{ month: string; value: number | null; suppressed: boolean }> }>;
  };

beforeEach(() => vi.clearAllMocks());

// ── FIX 3: getExecutiveKpis pendingAdjustments floor ─────────────────────────
describe('monitoring getExecutiveKpis pendingAdjustments (FIX 3)', () => {
  const stub = () => {
    userCount.mockResolvedValue(50);
    vacancyCount.mockResolvedValue(4);
    surveyCount.mockResolvedValue(2);
    alertCount.mockResolvedValue(1);
  };

  it('pendingAdjustments = 3 → null + pendingAdjustmentsSuppressed true', async () => {
    stub();
    salaryAdjustmentCount.mockResolvedValue(3); // sub-floor
    const r = await caller().getExecutiveKpis();
    expect(r.pendingAdjustments).toBeNull();
    expect(r.pendingAdjustmentsSuppressed).toBe(true);
    // non-restricted KPIs stay populated
    expect(r.activeVacancies).toBe(4);
    expect(r.totalEmployees).toBe(50);
  });

  it('pendingAdjustments = 7 → real count, not suppressed', async () => {
    stub();
    salaryAdjustmentCount.mockResolvedValue(7);
    const r = await caller().getExecutiveKpis();
    expect(r.pendingAdjustments).toBe(7);
    expect(r.pendingAdjustmentsSuppressed).toBe(false);
  });

  it('pendingAdjustments = 0 passes through (reveals no individual)', async () => {
    stub();
    salaryAdjustmentCount.mockResolvedValue(0);
    const r = await caller().getExecutiveKpis();
    expect(r.pendingAdjustments).toBe(0);
    expect(r.pendingAdjustmentsSuppressed).toBe(false);
  });
});

// ── FIX 4: getCrossModuleTrend engagement per-point floor ────────────────────
describe('monitoring getCrossModuleTrend engagement point floor (FIX 4)', () => {
  it('a month with 1..4 responses → that point is null + suppressed', async () => {
    // 6 months, return 3 (sub-floor) for every month.
    surveyResponseCount.mockResolvedValue(3);
    const r = await caller().getCrossModuleTrend({ metric: 'engagement', period: '6m' });
    expect(r.data).toHaveLength(6);
    expect(r.data.every((p) => p.value === null)).toBe(true);
    expect(r.data.every((p) => p.suppressed === true)).toBe(true);
  });

  it('a month with >=5 responses → exact value, not suppressed', async () => {
    surveyResponseCount.mockResolvedValue(40);
    const r = await caller().getCrossModuleTrend({ metric: 'engagement', period: '6m' });
    expect(r.data.every((p) => p.value === 40)).toBe(true);
    expect(r.data.every((p) => p.suppressed === false)).toBe(true);
  });

  it('a month with 0 responses passes through (reveals no individual)', async () => {
    surveyResponseCount.mockResolvedValue(0);
    const r = await caller().getCrossModuleTrend({ metric: 'engagement', period: '6m' });
    expect(r.data.every((p) => p.value === 0)).toBe(true);
    expect(r.data.every((p) => p.suppressed === false)).toBe(true);
  });

  it('non-sensitive metric (headcount) is never suppressed (not over a restricted model)', async () => {
    userCount.mockResolvedValue(3); // tiny headcount is NOT a restricted-population leak
    const r = await caller().getCrossModuleTrend({ metric: 'headcount', period: '6m' });
    expect(r.data.every((p) => p.value === 3)).toBe(true);
    expect(r.data.every((p) => p.suppressed === false)).toBe(true);
  });
});

// ── SLICE 6 round 11 regression: monthly-differencing oracle ─────────────────
//
// Scenario: 1 survey, 8 total responses. Over a 6-month window:
//   month 5 (Jan) = 5 responses  (≥5, per-point passes)
//   month 6 (Feb) = 3 responses  (sub-floor, per-point would suppress)
//   all other months = 0
//
// Old (per-point) behaviour: Jan=5, Feb=null, rest=0.
// Attack: caller knows total=8 from getDashboardKpis/getExecutiveKpis
//         → 8 − 5 − 0 − 0 − 0 − 0 = 3  →  Feb=3 recovered.
//
// New (all-or-nothing) behaviour: ANY month sub-floor → null EVERY month.
//   Jan=null, Feb=null, rest=null; 8 − null is unsolvable; Feb not recoverable.
describe('slice 6 round 11 — all-or-nothing engagement trend (monthly-differencing oracle regression)', () => {
  it('mixed window (visible ≥5 month + sub-floor month) → ALL months null + suppressed', async () => {
    // 6 months. Set up: months in order oldest→newest get counts 0,0,0,0,5,3.
    // (The loop in getCrossModuleTrend iterates i = months-1 → 0 oldest first.)
    surveyResponseCount
      .mockResolvedValueOnce(0) // month 1
      .mockResolvedValueOnce(0) // month 2
      .mockResolvedValueOnce(0) // month 3
      .mockResolvedValueOnce(0) // month 4
      .mockResolvedValueOnce(5) // month 5 — passes per-point floor on its own
      .mockResolvedValueOnce(3); // month 6 — sub-floor; triggers all-or-nothing gate

    const r = await caller().getCrossModuleTrend({ metric: 'engagement', period: '6m' });

    expect(r.data).toHaveLength(6);
    // All-or-nothing: EVERY point must be null + suppressed.
    // If per-point suppression were still in place, data[4].value would be 5 (not null),
    // allowing 8−5=3 to recover data[5].value.
    expect(r.data.every((p) => p.value === null)).toBe(true);
    expect(r.data.every((p) => p.suppressed === true)).toBe(true);
  });

  it('all months ≥5 → all values pass through (no suppression)', async () => {
    // No sub-floor month: 5,6,7,8,9,10 — gate should NOT fire; real values returned.
    surveyResponseCount
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(10);

    const r = await caller().getCrossModuleTrend({ metric: 'engagement', period: '6m' });

    expect(r.data).toHaveLength(6);
    expect(r.data.every((p) => p.suppressed === false)).toBe(true);
    expect(r.data.every((p) => p.value !== null)).toBe(true);
    // Spot-check first and last values.
    expect(r.data[0]?.value).toBe(5);
    expect(r.data[5]?.value).toBe(10);
  });

  it('all months 0 → all pass through (empty bucket reveals no individual)', async () => {
    surveyResponseCount.mockResolvedValue(0);
    const r = await caller().getCrossModuleTrend({ metric: 'engagement', period: '6m' });
    expect(r.data.every((p) => p.value === 0 && !p.suppressed)).toBe(true);
  });
});
