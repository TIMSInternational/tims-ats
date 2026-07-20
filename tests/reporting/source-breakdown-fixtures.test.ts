/**
 * source-breakdown-fixtures.test.ts — Phase-5 reporting strangler, Slice 5 increment 4.
 *
 * Asserts the REAL @tims/shared buildSourceBreakdown (the same builder
 * recruitmentAnalytics.getSourceBreakdown now returns) against the shared golden
 * contracts/reporting-fixtures/source-breakdown.json — the SAME fixture the C#
 * SourceBreakdownBuilder unit tests assert. Anti-drift: a divergence in either stack
 * (stable descending sort, top-6 slice, hires-by-source) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSourceBreakdown, type SourceApplications, type SourceBreakdownItem } from '@tims/shared';

interface Case {
  name: string;
  input: { apps: SourceApplications[]; hireSources: string[] };
  expected: SourceBreakdownItem[];
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'reporting-fixtures', 'source-breakdown.json'), 'utf8'),
) as { cases: Case[] };

describe('buildSourceBreakdown — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildSourceBreakdown(c.input.apps, c.input.hireSources)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
  });
});
