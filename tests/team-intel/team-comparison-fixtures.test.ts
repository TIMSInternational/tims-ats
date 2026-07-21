/**
 * team-comparison-fixtures.test.ts — Phase-5 team-intel strangler, Slice 6.
 *
 * Asserts the REAL @tims/shared buildTeamComparison (the same builder teamIntel.compareTeams returns)
 * against contracts/team-intel-fixtures/team-comparison.json — the SAME fixture the C#
 * TeamComparisonBuilder unit tests assert. Anti-drift: input order, leader passthrough (present/null),
 * 30-day-month half-up avgTenureMonths, distinct-non-empty roles, and passthrough counts turn this red
 * if either stack drifts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildTeamComparison, type TeamComparisonView } from '@tims/shared';

interface Case {
  name: string;
  input: {
    teams: {
      id: string;
      name: string;
      leader: { id: string; firstName: string; lastName: string } | null;
      members: { jobTitle: string | null; createdAtMs: number }[];
      openVacancies: number;
      activeOkrs: number;
    }[];
    nowMs: number;
  };
  expected: TeamComparisonView;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'team-intel-fixtures', 'team-comparison.json'), 'utf8'),
) as { cases: Case[] };

describe('buildTeamComparison — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const teams = c.input.teams.map((t) => ({
        ...t,
        members: t.members.map((m) => ({ jobTitle: m.jobTitle, createdAt: new Date(m.createdAtMs) })),
      }));
      expect(buildTeamComparison(teams, c.input.nowMs)).toEqual(c.expected);
    });
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(3));
});
