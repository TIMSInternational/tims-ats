import { describe, it, expect } from 'vitest';

// ── Characterization tests for the monitoring pure kernels (issue #100, step 1) ──────────────
//
// These pin the TS behaviour the C# port (Tims.Domain/Monitoring/MonitoringKernels.cs) must
// reproduce byte-for-byte. They import the REAL exports the router runs (the honest-fixture
// rule) — NOT a hand-rolled mirror — so a drift in either direction reddens here first.
//
// Every golden below is duplicated verbatim in
// services/Tims.Platform/tests/Tims.UnitTests/Monitoring/MonitoringKernelsFixtureTests.cs.
// If you change one side you MUST change the other; that is the point of the pairing.
//
// These pin INVARIANTS, not an era: each case states the security/product rule it encodes,
// so a future fix to a quirk has to argue with the rule rather than delete an assertion.

import {
  MONITORING_MODULES,
  MONITORING_TREND_MONTHS,
  applyEngagementTrendFloor,
  buildModuleHealth,
  buildMonthWindow,
  moduleHealthStatus,
} from '../../packages/api/src/services/monitoring.service';

// `buildMonthWindow` constructs LOCAL-time dates (`new Date(y, m, d)`), so its instants depend
// on the host timezone. The C# port models local === UTC, which is correct on the production
// hosts (Vercel Node and the platform container both run UTC) but NOT on a developer machine.
//
// These tests must therefore pin the WALL-CLOCK components — that is the kernel's real
// invariant and exactly what the C# port renders as a UTC instant — rather than the raw
// `toISOString()`, which would be green only on a UTC runner and would silently drift into a
// timezone assertion nobody intended. `wallClockIso` reads the local components back and
// re-renders them as the equivalent UTC instant, so every expectation below is the LITERAL
// golden the C# `MonitoringKernelsFixtureTests` asserts, on any host.
function wallClockIso(d: Date): string {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ),
  ).toISOString();
}

// Anchors are built in LOCAL time (midday, so no DST/offset edge can shift the day-of-month).
const localMs = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0, 0).getTime();

// ── moduleHealthStatus / buildModuleHealth ───────────────────────────────────────────────────
describe('moduleHealthStatus — the 0 / 1-2 / 3+ bands', () => {
  it('0 active alerts → healthy', () => {
    expect(moduleHealthStatus(0)).toBe('healthy');
  });

  it('1 and 2 → warning (the inclusive upper edge of the warning band)', () => {
    expect(moduleHealthStatus(1)).toBe('warning');
    expect(moduleHealthStatus(2)).toBe('warning');
  });

  it('3 → critical (the first count past the warning band)', () => {
    expect(moduleHealthStatus(3)).toBe('critical');
    expect(moduleHealthStatus(50)).toBe('critical');
  });
});

describe('buildModuleHealth', () => {
  it('reports all 8 modules in a fixed order', () => {
    expect(MONITORING_MODULES).toEqual([
      'recruitment',
      'onboarding',
      'people',
      'engagement',
      'compensation',
      'dei',
      'time',
      'performance',
    ]);
  });

  it('EMPTY database → 8 rows of 0/healthy, never an empty array', () => {
    // "Ask what your check prints against an EMPTY database" — the answer must be a full,
    // honest 8-row zero report, not a missing surface.
    const rows = buildModuleHealth({});
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.activeAlerts === 0 && r.status === 'healthy')).toBe(true);
  });

  it('projects a sparse count map and drops unknown modules', () => {
    const rows = buildModuleHealth({ recruitment: 2, dei: 3, not_a_module: 99 });
    expect(rows.find((r) => r.module === 'recruitment')).toEqual({
      module: 'recruitment',
      activeAlerts: 2,
      status: 'warning',
    });
    expect(rows.find((r) => r.module === 'dei')).toEqual({
      module: 'dei',
      activeAlerts: 3,
      status: 'critical',
    });
    expect(rows.map((r) => r.module)).not.toContain('not_a_module');
    // Every other module still reports 0/healthy.
    expect(rows.filter((r) => r.activeAlerts === 0)).toHaveLength(6);
  });
});

// ── buildMonthWindow ─────────────────────────────────────────────────────────────────────────
describe('MONITORING_TREND_MONTHS', () => {
  it('maps each period to its month count', () => {
    expect(MONITORING_TREND_MONTHS).toEqual({ '6m': 6, '12m': 12, '24m': 24 });
  });
});

describe('buildMonthWindow', () => {
  // A day-5 anchor, so no setMonth day-overflow.
  const AUG_5 = localMs(2026, 7, 5);

  it('returns `months` points oldest → newest, labelled YYYY-MM', () => {
    const w = buildMonthWindow(AUG_5, 6);
    expect(w.map((p) => p.label)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
  });

  it('crosses the year boundary by borrowing a year', () => {
    const w = buildMonthWindow(localMs(2026, 1, 10), 4); // Feb 2026
    expect(w.map((p) => p.label)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('monthStart is midnight on day 1 of the labelled month', () => {
    const w = buildMonthWindow(AUG_5, 2);
    expect(wallClockIso(w[0]!.monthStart)).toBe('2026-07-01T00:00:00.000Z');
    expect(wallClockIso(w[1]!.monthStart)).toBe('2026-08-01T00:00:00.000Z');
  });

  it('monthEnd is MIDNIGHT on the last day — not end-of-day (a live quirk, pinned not fixed)', () => {
    // INVARIANT PINNED: the upper bound is `new Date(y, m + 1, 0)`, i.e. 00:00:00.000 on the
    // final day of the month. A survey response submitted at 09:00 on 31 July is therefore in
    // NO bucket. This is the production reader's arithmetic; the C# port reproduces it exactly.
    // If it is ever fixed it must be fixed on BOTH stacks in the same change, and this test
    // rewritten to state the new bound — not deleted.
    const w = buildMonthWindow(AUG_5, 2);
    expect(wallClockIso(w[0]!.monthEnd)).toBe('2026-07-31T00:00:00.000Z');
    expect(wallClockIso(w[1]!.monthEnd)).toBe('2026-08-31T00:00:00.000Z');
  });

  it('February end-bound respects leap years', () => {
    const leap = buildMonthWindow(localMs(2028, 1, 15), 1); // Feb 2028 (leap)
    expect(wallClockIso(leap[0]!.monthEnd)).toBe('2028-02-29T00:00:00.000Z');
    const nonLeap = buildMonthWindow(localMs(2026, 1, 15), 1); // Feb 2026
    expect(wallClockIso(nonLeap[0]!.monthEnd)).toBe('2026-02-28T00:00:00.000Z');
  });

  it('setMonth DAY-OVERFLOW is preserved: from the 31st, short months roll forward', () => {
    // INVARIANT PINNED: `new Date(2026-03-31).setMonth(1)` is "Feb 31" → 2026-03-03, so the
    // 2-month window anchored on 31 March labels BOTH points `2026-03`. That is what the live
    // reader returns today; a "fix" would silently change every dashboard's month labels on the
    // 29th–31st of a month, so it is pinned here and reproduced in the C# port.
    const w = buildMonthWindow(localMs(2026, 2, 31), 2); // 2026-03-31
    expect(w.map((p) => p.label)).toEqual(['2026-03', '2026-03']);
    expect(wallClockIso(w[0]!.monthStart)).toBe('2026-03-01T00:00:00.000Z');
    expect(wallClockIso(w[1]!.monthStart)).toBe('2026-03-01T00:00:00.000Z');
  });

  it('day-31 overflow across a 31-day month does NOT shift (May 31 → back 1 month = May 1?)', () => {
    // 2026-05-31 minus 1 month → "Apr 31" → 2026-05-01 (April has 30 days, so it rolls 1 day).
    // Minus 0 → 2026-05-31. Both label 2026-05. Pinned because it is the SECOND distinct
    // overflow shape (roll of exactly 1 day, vs the 3-day February roll above).
    const w = buildMonthWindow(localMs(2026, 4, 31), 2);
    expect(w.map((p) => p.label)).toEqual(['2026-05', '2026-05']);
  });

  it('a full 24-month window ends on the anchor month and starts 23 months earlier', () => {
    const w = buildMonthWindow(AUG_5, 24);
    expect(w).toHaveLength(24);
    expect(w[0]!.label).toBe('2024-09');
    expect(w[23]!.label).toBe('2026-08');
  });
});

// ── applyEngagementTrendFloor ────────────────────────────────────────────────────────────────
describe('applyEngagementTrendFloor — all-or-nothing sub-floor guard', () => {
  const labels = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];

  it('EMPTY database (all zero) → real zeroes, NOT suppressed', () => {
    // A zero bucket identifies nobody. Suppressing it would be a false tick that hides an
    // honest "no data" behind a privacy flag.
    const out = applyEngagementTrendFloor(labels, [0, 0, 0, 0, 0, 0]);
    expect(out.every((p) => p.value === 0 && p.suppressed === false)).toBe(true);
    expect(out.map((p) => p.month)).toEqual(labels);
  });

  it('all months >= 5 → exact values pass through', () => {
    const out = applyEngagementTrendFloor(labels, [5, 6, 7, 8, 9, 10]);
    expect(out.map((p) => p.value)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(out.every((p) => p.suppressed === false)).toBe(true);
  });

  it('ONE sub-floor month nulls EVERY month (monthly-differencing oracle closed)', () => {
    // INVARIANT: with total-N known from getExecutiveKpis, leaving the >=5 months visible lets
    // the caller compute 8 - 5 = 3 and recover the hidden month. Nulling the whole series
    // removes every complementary bucket.
    const out = applyEngagementTrendFloor(labels, [0, 0, 0, 0, 5, 3]);
    expect(out.every((p) => p.value === null)).toBe(true);
    expect(out.every((p) => p.suppressed === true)).toBe(true);
  });

  it('the boundary is 5: a 4 suppresses the series, a 5 alone does not', () => {
    expect(applyEngagementTrendFloor(labels, [4, 9, 9, 9, 9, 9]).every((p) => p.suppressed)).toBe(true);
    expect(applyEngagementTrendFloor(labels, [5, 9, 9, 9, 9, 9]).every((p) => p.suppressed)).toBe(false);
  });

  it('mixed zeroes and a sub-floor month still suppress everything (a 0 is not a free pass)', () => {
    const out = applyEngagementTrendFloor(labels, [0, 0, 0, 0, 0, 1]);
    expect(out.every((p) => p.value === null && p.suppressed === true)).toBe(true);
  });

  it('a label with no matching count yields null (never undefined) and keeps its month', () => {
    const out = applyEngagementTrendFloor(['a', 'b'], [7]);
    expect(out).toEqual([
      { month: 'a', value: 7, suppressed: false },
      { month: 'b', value: null, suppressed: false },
    ]);
  });
});
