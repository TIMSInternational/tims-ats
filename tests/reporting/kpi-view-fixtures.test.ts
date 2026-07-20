/**
 * kpi-view-fixtures.test.ts — Phase-5 reporting strangler, Slice 5 increment 3.
 *
 * Asserts the REAL @tims/shared buildKpiView (the same builder recruitmentAnalytics
 * .getKpis now returns) against the shared golden contracts/reporting-fixtures/
 * kpi-view.json — the SAME fixture the C# KpiViewBuilder unit tests assert. Anti-drift:
 * a divergence in either stack (span filtering, half-up rounding, strictly-over
 * lost-by-delay) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildKpiView, type KpiViewInput, type KpiView } from '@tims/shared';

interface Case {
  name: string;
  input: KpiViewInput;
  expected: KpiView;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'reporting-fixtures', 'kpi-view.json'), 'utf8'),
) as { cases: Case[] };

describe('buildKpiView — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildKpiView(c.input)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
  });
});
