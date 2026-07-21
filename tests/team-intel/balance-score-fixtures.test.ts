/**
 * balance-score-fixtures.test.ts — Phase-5 team-intel strangler, Slice 6.
 *
 * Asserts the REAL @tims/shared buildBalanceScore (the same builder teamIntel.getBalanceScore
 * returns, wrapped with teamId) against contracts/team-intel-fixtures/balance-score.json — the SAME
 * fixture the C# BalanceScoreBuilder unit tests assert. Anti-drift: 30-day months, JS half-up, the
 * integer-percent roleDiversity, the sizeScore piecewise, and empty-team behavior turn this red if
 * either stack drifts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildBalanceScore, type BalanceScoreView } from '@tims/shared';

interface Case {
  name: string;
  input: { members: { jobTitle: string | null; createdAtMs: number }[]; nowMs: number };
  expected: BalanceScoreView;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'team-intel-fixtures', 'balance-score.json'), 'utf8'),
) as { cases: Case[] };

describe('buildBalanceScore — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const members = c.input.members.map((m) => ({
        jobTitle: m.jobTitle,
        createdAt: new Date(m.createdAtMs),
      }));
      expect(buildBalanceScore(members, c.input.nowMs)).toEqual(c.expected);
    });
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(5));
});
