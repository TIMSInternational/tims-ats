/**
 * lost-by-delay-view-fixtures.test.ts — Phase-5 reporting strangler, Slice 5 increment 4.
 *
 * Asserts the REAL @tims/shared buildLostByDelayView (the same builder
 * recruitmentAnalytics.getLostByDelay now returns) against the shared golden
 * contracts/reporting-fixtures/lost-by-delay-view.json — the SAME fixture the C#
 * LostByDelayViewBuilder unit tests assert. Anti-drift: a divergence in either stack
 * (group-by-name, first-seen SLA, strictly-over boundary, half-up rounding, stable
 * lostCount sort) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildLostByDelayView, type LostByDelayApp, type LostByDelayView } from '@tims/shared';

interface Case {
  name: string;
  input: { rejected: LostByDelayApp[] };
  expected: LostByDelayView;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'reporting-fixtures', 'lost-by-delay-view.json'), 'utf8'),
) as { cases: Case[] };

describe('buildLostByDelayView — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildLostByDelayView(c.input.rejected)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
  });
});
