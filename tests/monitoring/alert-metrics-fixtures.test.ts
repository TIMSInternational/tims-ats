import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AlertMetricKey } from '@tims/shared';

// The repository module imports `@tims/db` at load time; this suite only exercises its PURE exports
// (the floor + the sensitivity predicate), so the Prisma client is stubbed to keep the import cheap.
vi.mock('@tims/db', () => ({
  db: {
    salaryAdjustment: { count: vi.fn() },
    vacancy: { count: vi.fn() },
    user: { count: vi.fn() },
    survey: { count: vi.fn() },
    alert: { count: vi.fn() },
    alertRule: { findMany: vi.fn() },
    application: { findMany: vi.fn() },
  },
}));

const { applyAlertMetricFloor, isSensitiveAlertMetric, ALERT_METRICS_VIA_CSHARP } =
  await import('../../packages/api/src/repositories/alert-evaluation.repository');

/**
 * #172 — the cross-org alert-metric surface, pinned to the goldens the C# port also asserts
 * (contracts/alert-metrics-fixtures/cases.json ↔ Tims.UnitTests/AlertMetrics/AlertMetricsFixtureTests.cs).
 *
 * These exercise the REAL exports the cron calls (`applyAlertMetricFloor` is what `computeMetric` runs),
 * not a copy. Once flips #64/#66 land, the `surveys` and `salary_adjustments` counts come from C# — and
 * from that moment the §21 min-5 floor exists in two codebases at once. A divergence is invisible in
 * production and wrong in both directions: under-flooring turns an alert rule back into an exact-count
 * oracle over salary data, over-flooring silently stops `active_surveys` alerts for every small org.
 */

interface FloorCase {
  name: string;
  metric: AlertMetricKey;
  raw: number;
  expectedStatus: 'value' | 'suppressed';
  expectedValue: number | null;
}
interface SensitivityCase {
  name: string;
  metric: AlertMetricKey;
  sensitive: boolean;
}
interface MetricKeyCase {
  name: string;
  input: string | null;
  valid: boolean;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'alert-metrics-fixtures', 'cases.json'), 'utf8'),
) as {
  servedMetrics: string[];
  sensitivity: SensitivityCase[];
  floor: FloorCase[];
  metricKeys: MetricKeyCase[];
};

describe('alert-metrics — cross-stack goldens', () => {
  it('every section has cases (floor guard — the loops below are quantifiers)', () => {
    expect(fixture.floor.length).toBeGreaterThanOrEqual(9);
    expect(fixture.sensitivity.length).toBeGreaterThanOrEqual(2);
    expect(fixture.metricKeys.length).toBeGreaterThanOrEqual(10);
    expect(fixture.servedMetrics.length).toBeGreaterThanOrEqual(2);
  });

  it('the boundary rows that carry the oracle guard are present by name, not just by count', () => {
    // A bare length check cannot tell a padded fixture from a complete one. These three rows ARE the
    // contract: 4→suppressed and 5→value are the off-by-one either side of the floor, and
    // active_surveys@1→value is the row that stops an over-eager "floor everything" change.
    const has = (metric: string, raw: number, status: string) =>
      fixture.floor.some((c) => c.metric === metric && c.raw === raw && c.expectedStatus === status);

    expect(has('pending_salary_adjustments', 4, 'suppressed')).toBe(true);
    expect(has('pending_salary_adjustments', 5, 'value')).toBe(true);
    expect(has('active_surveys', 1, 'value')).toBe(true);
  });

  for (const c of fixture.floor) {
    it(`applyAlertMetricFloor: ${c.name}`, () => {
      const actual = applyAlertMetricFloor(c.metric, c.raw);
      if (c.expectedStatus === 'suppressed') {
        expect(actual).toBeNull();
      } else {
        expect(actual).toBe(c.expectedValue);
      }
    });
  }

  for (const c of fixture.sensitivity) {
    it(`isSensitiveAlertMetric: ${c.name}`, () => {
      expect(isSensitiveAlertMetric(c.metric)).toBe(c.sensitive);
    });
  }

  it('the C#-served set is EXACTLY the golden set — not a superset', () => {
    // Derived from the fixture (the shared source of truth), never from the TS constant under test:
    // deriving the expectation from the thing being checked is circular and silently narrows.
    expect([...ALERT_METRICS_VIA_CSHARP].sort()).toEqual([...fixture.servedMetrics].sort());
  });

  it('a metric the surface does not serve is never routed to C#', () => {
    // The four real ALERT_METRIC_KEYS whose tables do not flip must stay on the Prisma path forever.
    // If one of these ever appears in the routed set, the cron starts asking C# for a metric it has no
    // reader for — which the use case answers as `unavailable`, i.e. that rule stops evaluating.
    for (const c of fixture.metricKeys.filter((k) => !k.valid && k.input)) {
      expect(ALERT_METRICS_VIA_CSHARP).not.toContain(c.input as AlertMetricKey);
    }
  });

  it('the floor is idempotent — re-applying it to an already-floored value changes nothing', () => {
    // This is what makes it safe for the TS caller to floor a value the C# surface already floored.
    // If it were not idempotent, the double application would corrupt legitimate counts.
    for (const c of fixture.floor) {
      const once = applyAlertMetricFloor(c.metric, c.raw);
      expect(applyAlertMetricFloor(c.metric, once)).toBe(once);
    }
  });

  it('null passes through the floor untouched, for every served metric', () => {
    // `computeRawMetric` returns null for an unknown key and for a suppressed C# response. A floor that
    // coerced null to 0 would turn "unknown" into "no breach" — the silent-failure class this slice exists
    // to close, and one tsc cannot catch because number widens into number | null.
    for (const metric of ALERT_METRICS_VIA_CSHARP) {
      expect(applyAlertMetricFloor(metric, null)).toBeNull();
    }
  });
});
