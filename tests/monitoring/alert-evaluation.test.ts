import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateCondition } from '../../packages/api/src/services/alert-evaluation.service';

// ── @tims/db mock for the alert-evaluation repository (computeMetric oracle guard) ──
const salaryAdjustmentCount = vi.fn();
const vacancyCount = vi.fn();
const userCount = vi.fn();
const surveyCount = vi.fn();
const alertCount = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    salaryAdjustment: { count: (...a: unknown[]) => salaryAdjustmentCount(...a) },
    vacancy: { count: (...a: unknown[]) => vacancyCount(...a) },
    user: { count: (...a: unknown[]) => userCount(...a) },
    survey: { count: (...a: unknown[]) => surveyCount(...a) },
    alert: { count: (...a: unknown[]) => alertCount(...a) },
    application: { findMany: vi.fn() },
  },
}));

describe('evaluateCondition — operator comparison', () => {
  it('gt: breaches when value strictly exceeds threshold', () => {
    expect(evaluateCondition(11, 'gt', 10)).toBe(true);
    expect(evaluateCondition(10, 'gt', 10)).toBe(false);
    expect(evaluateCondition(9, 'gt', 10)).toBe(false);
  });

  it('gte: breaches at or above threshold', () => {
    expect(evaluateCondition(10, 'gte', 10)).toBe(true);
    expect(evaluateCondition(9, 'gte', 10)).toBe(false);
  });

  it('lt: breaches when strictly below threshold', () => {
    expect(evaluateCondition(4, 'lt', 5)).toBe(true);
    expect(evaluateCondition(5, 'lt', 5)).toBe(false);
  });

  it('lte: breaches at or below threshold', () => {
    expect(evaluateCondition(5, 'lte', 5)).toBe(true);
    expect(evaluateCondition(6, 'lte', 5)).toBe(false);
  });

  it('eq: breaches only on exact equality', () => {
    expect(evaluateCondition(7, 'eq', 7)).toBe(true);
    expect(evaluateCondition(8, 'eq', 7)).toBe(false);
  });

  it('returns false for a null metric value (unknown/uncomputable ⇒ never fire)', () => {
    expect(evaluateCondition(null, 'gt', 0)).toBe(false);
    expect(evaluateCondition(null, 'lte', 100)).toBe(false);
  });

  it('returns false for an unknown operator (fail-safe, no accidental fire)', () => {
    // @ts-expect-error — exercising the defensive default branch
    expect(evaluateCondition(100, 'between', 5)).toBe(false);
  });
});

// ── round 8 FIX 5: computeMetric sensitive-metric oracle guard ───────────────
// A monitoring updater configures a rule `pending_salary_adjustments eq 3` and watches
// whether an alert fires — recovering a sub-floor count over SalaryAdjustment. So a
// sensitive metric value in 1..4 is floored to null (the rule cannot fire as an oracle
// and no sub-floor value is persisted). Non-sensitive metrics are unchanged.
describe('computeMetric sensitive-metric oracle guard (FIX 5)', () => {
  // Import lazily so the @tims/db mock is in place before the module under test loads.
  let computeMetric: (orgId: string, metric: string) => Promise<number | null>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../packages/api/src/repositories/alert-evaluation.repository');
    computeMetric = mod.alertEvaluationRepository.computeMetric.bind(mod.alertEvaluationRepository) as typeof computeMetric;
  });

  it('sensitive metric (pending_salary_adjustments) = 3 → computeMetric returns null (no oracle)', async () => {
    salaryAdjustmentCount.mockResolvedValue(3);
    const value = await computeMetric('org-1', 'pending_salary_adjustments');
    expect(value).toBeNull();
    // and a null value can never fire a rule, even an `eq 3` oracle rule.
    expect(evaluateCondition(value, 'eq', 3)).toBe(false);
    expect(evaluateCondition(value, 'lte', 4)).toBe(false);
  });

  it('sensitive metric = 0 passes through (reveals no individual)', async () => {
    salaryAdjustmentCount.mockResolvedValue(0);
    expect(await computeMetric('org-1', 'pending_salary_adjustments')).toBe(0);
  });

  it('sensitive metric >= 5 passes through unchanged', async () => {
    salaryAdjustmentCount.mockResolvedValue(7);
    expect(await computeMetric('org-1', 'pending_salary_adjustments')).toBe(7);
  });

  it('NON-sensitive metric (headcount) = 3 is unchanged (not a restricted population)', async () => {
    userCount.mockResolvedValue(3);
    const value = await computeMetric('org-1', 'headcount');
    expect(value).toBe(3);
    // a non-sensitive `eq 3` rule fires normally — only sensitive metrics are floored.
    expect(evaluateCondition(value, 'eq', 3)).toBe(true);
  });

  it('NON-sensitive metric (active_alerts) = 2 is unchanged', async () => {
    alertCount.mockResolvedValue(2);
    expect(await computeMetric('org-1', 'active_alerts')).toBe(2);
  });
});
