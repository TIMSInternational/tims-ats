/**
 * recruiter-sla-view-fixtures.test.ts — Phase-5 reporting strangler, Slice 5 increment 4.
 *
 * Asserts the REAL @tims/shared buildRecruiterSlaView (the same builder
 * recruitmentAnalytics.getRecruiterSla now returns) against the shared golden
 * contracts/reporting-fixtures/recruiter-sla-view.json — the SAME fixture the C#
 * RecruiterSlaViewBuilder unit tests assert. Anti-drift: a divergence in either stack
 * (first-seen name, candidate sum, non-negative-span ttf, null-SLA exclusion, stable
 * vacancy-descending sort) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRecruiterSlaView, type RecruiterSlaInput, type RecruiterSlaRow } from '@tims/shared';

interface Case {
  name: string;
  input: RecruiterSlaInput;
  expected: RecruiterSlaRow[];
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'reporting-fixtures', 'recruiter-sla-view.json'), 'utf8'),
) as { cases: Case[] };

describe('buildRecruiterSlaView — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildRecruiterSlaView(c.input)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
  });
});
