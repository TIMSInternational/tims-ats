/**
 * funnel-view-fixtures.test.ts — Phase-5 reporting strangler, Slice 5 increment 1.
 *
 * Asserts the REAL @tims/shared buildFunnelView (the same builder recruitmentAnalytics
 * .getFunnel now returns) against the shared golden contracts/reporting-fixtures/
 * funnel-view.json — the SAME fixture the C# FunnelViewBuilder unit tests assert. Anti-
 * drift: a divergence in either stack turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildFunnelView, type FunnelViewInput, type FunnelView } from '@tims/shared';

interface Case {
  name: string;
  input: FunnelViewInput;
  expected: FunnelView;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'reporting-fixtures', 'funnel-view.json'), 'utf8'),
) as { cases: Case[] };

describe('buildFunnelView — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildFunnelView(c.input)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
  });
});
