// Monitoring pure kernels — Phase-5 Q0b slice 1 (issue #100), step 1 "characterize".
//
// These are the ONLY behaviour-bearing pieces of `routers/monitoring.ts` that are not a
// database call. They are extracted here (a) so the characterization tests exercise the REAL
// export the router runs — the honest-fixture rule, not a hand-rolled mirror — and (b) so the
// C# port (`Tims.Domain/Monitoring/MonitoringKernels.cs`) has a single, golden-fixtured
// specification to be parity-checked against on BOTH stacks.
//
// Nothing here touches Prisma, tRPC or `ctx`. Suppression itself lives in `../access`
// (`suppressBelowMin5`, MIN_AGGREGATE_SIZE = 5) and is imported, never re-implemented.

import { suppressBelowMin5 } from '../access';

/** The 8 modules `getModuleHealth` reports on, in output order. */
export const MONITORING_MODULES = [
  'recruitment',
  'onboarding',
  'people',
  'engagement',
  'compensation',
  'dei',
  'time',
  'performance',
] as const;

export type MonitoringModule = (typeof MONITORING_MODULES)[number];

export type ModuleHealthStatus = 'healthy' | 'warning' | 'critical';

export interface ModuleHealthPoint {
  module: string;
  activeAlerts: number;
  status: ModuleHealthStatus;
}

/**
 * Health band for one module's ACTIVE alert count.
 * 0 (or a module with no row at all) → healthy; 1..2 → warning; 3+ → critical.
 *
 * NOTE the boundary: the original expression is `!count ? 'healthy' : count <= 2 ? 'warning' : 'critical'`,
 * so a NEGATIVE count would fall into 'warning'. Counts are never negative, so the band is pinned
 * on the reachable domain only (0,1,2,3).
 */
export function moduleHealthStatus(activeAlerts: number): ModuleHealthStatus {
  if (!activeAlerts) return 'healthy';
  return activeAlerts <= 2 ? 'warning' : 'critical';
}

/**
 * Project a sparse `module → active alert count` map onto the fixed 8-module list.
 * A module absent from the map reports 0 / healthy (an EMPTY database returns all 8 rows
 * as `{ activeAlerts: 0, status: 'healthy' }` — never an empty array).
 */
export function buildModuleHealth(alertCountsByModule: Readonly<Record<string, number>>): ModuleHealthPoint[] {
  return MONITORING_MODULES.map((mod) => {
    const activeAlerts = alertCountsByModule[mod] || 0;
    return { module: mod, activeAlerts, status: moduleHealthStatus(activeAlerts) };
  });
}

/** Months per `getCrossModuleTrend` period. */
export const MONITORING_TREND_MONTHS: Readonly<Record<'6m' | '12m' | '24m', number>> = {
  '6m': 6,
  '12m': 12,
  '24m': 24,
};

export interface TrendMonth {
  /** `YYYY-MM` label, derived from the SHIFTED date (see the day-overflow note below). */
  label: string;
  /** Inclusive lower bound: local midnight on day 1 of the labelled month. */
  monthStart: Date;
  /**
   * Inclusive UPPER bound: local midnight on the LAST DAY of the labelled month
   * (`new Date(y, m + 1, 0)`), i.e. 00:00:00.000 — NOT end-of-day.
   *
   * That is a real quirk of the live TS reader, faithfully preserved: rows timestamped
   * after midnight on a month's final day fall OUTSIDE `{ gte: monthStart, lte: monthEnd }`
   * and are counted in no bucket at all. Changing it would change production numbers, so it
   * is pinned by a characterization test rather than silently fixed here.
   */
  monthEnd: Date;
}

/**
 * The rolling month window `getCrossModuleTrend` aggregates over, oldest → newest.
 *
 * `nowMs` is INJECTED (the live router called a fresh `new Date()` inside the loop). That is
 * the one deliberate deviation from the original and it is what makes the window testable;
 * it is observationally equivalent except in the vanishing case of the loop straddling a
 * month boundary, where the original could emit two different "current months".
 *
 * Day-overflow is preserved verbatim. The original does `date.setMonth(date.getMonth() - i)`
 * on a date that keeps its day-of-month, so from e.g. the 31st, "one month back" overflows:
 * 2026-03-31 minus 1 month → Feb 31 → normalises to 2026-03-03, and the window then carries
 * the label `2026-03` TWICE. Real behaviour of the live reader; pinned, not fixed.
 *
 * Timezone: `new Date(y, m, d)` is LOCAL time in both stacks. Production runs UTC on Node and
 * in the C# container, so the C# port models local === UTC. A non-UTC host would diverge; that
 * is stated as an explicit parity precondition, not a claim it was measured.
 */
export function buildMonthWindow(nowMs: number, months: number): TrendMonth[] {
  const window: TrendMonth[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(nowMs);
    date.setMonth(date.getMonth() - i);
    const year = date.getFullYear();
    const month = date.getMonth();
    window.push({
      label: `${year}-${String(month + 1).padStart(2, '0')}`,
      monthStart: new Date(year, month, 1),
      monthEnd: new Date(year, month + 1, 0),
    });
  }
  return window;
}

export interface TrendPoint {
  month: string;
  value: number | null;
  suppressed: boolean;
}

/**
 * All-or-nothing k-anonymity floor for the `engagement` trend metric (a raw COUNT over the
 * §21-restricted `survey_responses` population).
 *
 * If ANY month in the window is sub-floor (1..4), EVERY month is nulled and flagged
 * suppressed. Per-point suppression is not enough: a caller who knows the window total can
 * subtract the visible months to recover the hidden one (the monthly-differencing oracle,
 * slice 6 round 11). 0 passes through — an empty bucket reveals no individual, so an EMPTY
 * database returns real zeroes, not a tick of "suppressed".
 */
export function applyEngagementTrendFloor(labels: readonly string[], rawCounts: readonly number[]): TrendPoint[] {
  const anyMonthSubFloor = rawCounts.some((c) => suppressBelowMin5(c).suppressed);
  return labels.map((month, idx) => ({
    month,
    value: anyMonthSubFloor ? null : (rawCounts[idx] ?? null),
    suppressed: anyMonthSubFloor,
  }));
}
