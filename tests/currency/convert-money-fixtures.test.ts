/**
 * convert-money-fixtures.test.ts — Phase-5 compensation strangler, Slice 11c (FX gateway).
 *
 * Asserts the REAL @tims/shared PURE FX money kernels (convertMoneyWithRate / sumMoneyWithRates — the SAME
 * kernels the live packages/api/src/lib/currency.ts convertMoney/sumMoney now delegate to) against the shared
 * goldens contracts/compensation-fixtures/{convert-money,sum-money}.json — the SAME fixtures the C#
 * Tims.Domain.Compensation.CompensationKernels.ConvertMoney/SumMoney unit tests assert. FIXED rates only: the
 * live frankfurter fetch is NEVER fixtured. Anti-drift: any divergence in either stack (EPSILON half-up bias,
 * round-then-sum, converted flag) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  convertMoneyWithRate,
  sumMoneyWithRates,
  type ConvertedMoneyView,
  type MoneyRowInput,
} from '@tims/shared';

const dir = join(__dirname, '..', '..', 'contracts', 'compensation-fixtures');

interface ConvertCase {
  name: string;
  input: { amount: number; from: string; to: string; rate: number };
  expected: ConvertedMoneyView;
}
interface SumCase {
  name: string;
  input: { rows: MoneyRowInput[]; to: string };
  expected: { amount: number; converted: boolean };
}

const convertFixture = JSON.parse(
  readFileSync(join(dir, 'convert-money.json'), 'utf8'),
) as { cases: ConvertCase[] };
const sumFixture = JSON.parse(readFileSync(join(dir, 'sum-money.json'), 'utf8')) as { cases: SumCase[] };

describe('convertMoneyWithRate — golden parity (asserted identically by the C# port)', () => {
  for (const c of convertFixture.cases) {
    it(c.name, () => {
      expect(convertMoneyWithRate(c.input.amount, c.input.from, c.input.to, c.input.rate)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(convertFixture.cases.length).toBeGreaterThanOrEqual(6);
  });
});

describe('sumMoneyWithRates — golden parity (asserted identically by the C# port)', () => {
  for (const c of sumFixture.cases) {
    it(c.name, () => {
      expect(sumMoneyWithRates(c.input.rows, c.input.to)).toEqual(c.expected);
    });
  }

  it('has cases (fixture loaded)', () => {
    expect(sumFixture.cases.length).toBeGreaterThanOrEqual(4);
  });
});
