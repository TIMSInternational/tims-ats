/**
 * compa-ratio-distribution-fixtures.test.ts — Phase-5 compensation strangler, Slice 9.
 *
 * Asserts the REAL @tims/shared buildCompaRatioDistribution (the kernel the deleted
 * compensation.getCompaRatioDistribution used to return, and the one the C# port mirrors) against the shared golden
 * contracts/compensation-fixtures/compa-ratio-distribution.json — the SAME fixture the C#
 * CompensationKernels.BuildCompaRatioDistribution unit tests assert. Anti-drift: any divergence in either
 * stack (positive-salary bucketing, contributor-count avg floor, all-or-nothing empty distribution,
 * totalEmployees == positiveCount) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCompaRatioDistribution, type CompaRatioRow, type CompaRatioDistribution } from '@tims/shared';

interface Case {
  name: string;
  input: { rows: CompaRatioRow[] };
  expected: CompaRatioDistribution;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'compensation-fixtures', 'compa-ratio-distribution.json'), 'utf8'),
) as { cases: Case[] };

describe('buildCompaRatioDistribution — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildCompaRatioDistribution(c.input.rows)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
  });
});
