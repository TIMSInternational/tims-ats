/**
 * tenure-diversity-fixtures.test.ts — Phase-5 team-intel strangler, Slice 6.
 *
 * Asserts the REAL @tims/shared computeAvgTenureYears / computeRoleDiversity (the same helpers
 * teamIntel.getDashboardKpis returns) against the shared goldens contracts/team-intel-fixtures/
 * {avg-tenure-years,role-diversity}.json — the SAME fixtures the C# TeamIntelMetrics unit tests
 * assert. Anti-drift: a divergence in either stack (365-day divisor, JS half-up rounding, the
 * 2-decimal ratio, distinct-non-empty counting) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeAvgTenureYears, computeRoleDiversity } from '@tims/shared';

const dir = join(__dirname, '..', '..', 'contracts', 'team-intel-fixtures');
const load = (file: string) =>
  JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
    cases: { name: string; input: Record<string, unknown>; expected: number }[];
  };

describe('computeAvgTenureYears — golden parity (asserted identically by the C# port)', () => {
  const fixture = load('avg-tenure-years.json');
  for (const c of fixture.cases) {
    it(c.name, () => {
      const members = (c.input.members as { createdAtMs: number }[]).map((m) => ({
        createdAt: new Date(m.createdAtMs),
      }));
      expect(computeAvgTenureYears(members, c.input.nowMs as number)).toBe(c.expected);
    });
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(4));
});

describe('computeRoleDiversity — golden parity (asserted identically by the C# port)', () => {
  const fixture = load('role-diversity.json');
  for (const c of fixture.cases) {
    it(c.name, () => {
      const members = c.input.members as { jobTitle: string | null }[];
      expect(computeRoleDiversity(members)).toBe(c.expected);
    });
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(4));
});
