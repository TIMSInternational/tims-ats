/**
 * pay-equity-fixtures.test.ts — Phase-5 DEI strangler, Slice 11c (FX read).
 *
 * Asserts the REAL @tims/shared buildPayEquity PURE kernel (the SAME kernel dei.service.getPayEquity now delegates
 * its avg/median/gap shaping to) against the shared golden contracts/dei-fixtures/pay-equity.json — the SAME
 * fixture the C# Tims.Domain.Dei.DeiKernels.BuildPayEquity unit test asserts. byGender salaries are ALREADY
 * converted to the display currency (the impure convertMoney runs in the service). Any drift in either stack
 * (min-5 population / skipped / complement / cohort triggers, the female-vs-male gap%, the even-count median)
 * turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPayEquity, type PayEquityGenderInput } from '@tims/shared';

interface Case {
  name: string;
  input: {
    byGender: PayEquityGenderInput[];
    demographicGenderCounts: Record<string, number>;
    skippedSalaried: number;
    currency: string;
  };
  expected: unknown;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'dei-fixtures', 'pay-equity.json'), 'utf8'),
) as { cases: Case[] };

describe('buildPayEquity — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(
        buildPayEquity(c.input.byGender, c.input.demographicGenderCounts, c.input.skippedSalaried, c.input.currency),
      ).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
  });
});
