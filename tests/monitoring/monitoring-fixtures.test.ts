/**
 * monitoring-fixtures.test.ts — Phase-5 Q0b slice 1 (issue #100).
 *
 * Asserts the REAL monitoring kernels (`packages/api/src/services/monitoring.service.ts`, the exact
 * exports `routers/monitoring.ts` calls) against the shared goldens in
 * `contracts/monitoring-fixtures/` — the SAME files the C# `Tims.UnitTests/Monitoring` tests assert
 * against `Tims.Domain.Monitoring.MonitoringKernels`. One JSON, two stacks: a divergence on either
 * side turns that side's CI red, and a deliberate behaviour change has to edit the golden once and
 * face both suites.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyEngagementTrendFloor,
  buildModuleHealth,
  buildMonthWindow,
} from '../../packages/api/src/services/monitoring.service';

const dir = join(__dirname, '..', '..', 'contracts', 'monitoring-fixtures');

interface FixtureCase<TIn, TOut> {
  name: string;
  input: TIn;
  expected: TOut;
}

function load<TIn, TOut>(file: string): { cases: FixtureCase<TIn, TOut>[] } {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as { cases: FixtureCase<TIn, TOut>[] };
}

// Both window bounds are midnight, so the goldens carry wall-clock DATES. Read the local components
// back rather than `toISOString()`, which would silently make these timezone assertions.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('buildModuleHealth — golden parity (asserted identically by the C# port)', () => {
  const fixture = load<
    { alertCountsByModule: Record<string, number> },
    { module: string; activeAlerts: number; status: string }[]
  >('module-health.json');

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildModuleHealth(c.input.alertCountsByModule)).toEqual(c.expected);
    });
  }

  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(3));
});

describe('buildMonthWindow — golden parity (asserted identically by the C# port)', () => {
  const fixture = load<
    { anchor: { year: number; month: number; day: number; hour: number }; months: number },
    { label: string; start: string; end: string }[]
  >('month-window.json');

  for (const c of fixture.cases) {
    it(c.name, () => {
      const { year, month, day, hour } = c.input.anchor;
      // LOCAL anchor — the same wall-clock instant the C# side builds as an Unspecified DateTime.
      const nowMs = new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
      const actual = buildMonthWindow(nowMs, c.input.months).map((p) => ({
        label: p.label,
        start: ymd(p.monthStart),
        end: ymd(p.monthEnd),
      }));
      expect(actual).toEqual(c.expected);
    });
  }

  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(6));
});

describe('applyEngagementTrendFloor — golden parity (asserted identically by the C# port)', () => {
  const fixture = load<
    { labels: string[]; rawCounts: number[] },
    { month: string; value: number | null; suppressed: boolean }[]
  >('engagement-trend-floor.json');

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(applyEngagementTrendFloor(c.input.labels, c.input.rawCounts)).toEqual(c.expected);
    });
  }

  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(7));
});
