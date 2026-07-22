/**
 * competency-coverage-fixtures.test.ts — Phase-5 succession strangler, Slice 8.
 *
 * Asserts the REAL @tims/shared buildCompetencyCoverage (the same builder succession.getCompetencyCoverage
 * returns) against contracts/succession-fixtures/competency-coverage.json — the SAME fixture the C#
 * SuccessionKernels.BuildCompetencyCoverage unit tests assert. Turns red if either stack drifts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCompetencyCoverage, type CoverageRoleInput, type CoverageRow } from '@tims/shared';

interface Case {
  name: string;
  input: { roles: CoverageRoleInput[] };
  expected: CoverageRow[];
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'succession-fixtures', 'competency-coverage.json'), 'utf8'),
) as { cases: Case[] };

describe('buildCompetencyCoverage — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => expect(buildCompetencyCoverage(c.input.roles)).toEqual(c.expected));
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(3));
});
