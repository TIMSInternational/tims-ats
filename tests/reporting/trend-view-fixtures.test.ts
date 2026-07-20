/**
 * trend-view-fixtures.test.ts — Phase-5 reporting strangler, Slice 5 increment 2.
 *
 * Asserts the REAL @tims/shared buildTrendView (the same builder recruitmentAnalytics
 * .getTrend now returns) against the shared golden contracts/reporting-fixtures/
 * trend-view.json — the SAME fixture the C# TrendViewBuilder unit tests assert. Anti-
 * drift: a divergence in either stack (UTC bucketing, oldest-first order, month
 * normalization across the year boundary) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildTrendView, type TrendBucket } from '@tims/shared';

interface Case {
  name: string;
  input: { nowMs: number; appliedAtMs: number[] };
  expected: TrendBucket[];
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'reporting-fixtures', 'trend-view.json'), 'utf8'),
) as { cases: Case[] };

describe('buildTrendView — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildTrendView(c.input.nowMs, c.input.appliedAtMs)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
  });
});
