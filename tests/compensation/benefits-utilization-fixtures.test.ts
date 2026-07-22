/**
 * benefits-utilization-fixtures.test.ts — Phase-5 compensation strangler, Slice 9.
 *
 * Asserts the REAL @tims/shared buildBenefitsUtilization (the SAME kernel compensation
 * .getBenefitsUtilization now returns) against the shared golden
 * contracts/compensation-fixtures/benefits-utilization.json — the SAME fixture the C#
 * CompensationKernels.BuildBenefitsUtilization unit tests assert. Anti-drift: any divergence in either
 * stack (half-up rounding, no-users→0, NO min-5) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildBenefitsUtilization, type BenefitPlanInput, type BenefitUtilizationItem } from '@tims/shared';

interface Case {
  name: string;
  input: { plans: BenefitPlanInput[]; totalUsers: number };
  expected: BenefitUtilizationItem[];
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'compensation-fixtures', 'benefits-utilization.json'), 'utf8'),
) as { cases: Case[] };

describe('buildBenefitsUtilization — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildBenefitsUtilization(c.input.plans, c.input.totalUsers)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(3);
  });
});
