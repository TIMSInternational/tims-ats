import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { roundMoney } from '../../packages/api/src/lib/currency';

// WP1.6 THROWAWAY diff-harness (TS side). Asserts the REAL roundMoney emits the canonical
// string pinned in contracts/comp-fixtures/round-money.json — the exact same fixture the C#
// Tims.UnitTests MoneyDiffHarnessTests asserts. A value flowing byte-identically through both
// stacks validates the old-vs-new diff methodology reused in Phase 5. Not a committed migration.

interface Case { name: string; amount: number; rate: number; expected: string }
const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/comp-fixtures/round-money.json', import.meta.url)), 'utf8'),
) as { cases: Case[] };

/** Canonical output form both stacks compare byte-for-byte: fixed 2 decimals. */
const canonical = (amount: number, rate: number): string => roundMoney(amount * rate).toFixed(2);

describe('comp-diff-harness: round-money.json', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(canonical(c.amount, c.rate)).toBe(c.expected);
  });
});
