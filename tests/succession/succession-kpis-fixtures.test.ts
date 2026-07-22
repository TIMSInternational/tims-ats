/**
 * succession-kpis-fixtures.test.ts — Phase-5 succession strangler, Slice 8.
 *
 * Asserts the REAL @tims/shared buildSuccessionKpis (the same builder succession.getDashboardKpis returns)
 * against contracts/succession-fixtures/succession-kpis.json — the SAME fixture the C#
 * SuccessionKernels.BuildSuccessionKpis unit tests assert. Pins coverageRate/avgSuccessorsPerRole half-up.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSuccessionKpis, type SuccessionKpiCounts, type SuccessionKpiView } from '@tims/shared';

interface Case {
  name: string;
  input: { counts: SuccessionKpiCounts };
  expected: SuccessionKpiView;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'succession-fixtures', 'succession-kpis.json'), 'utf8'),
) as { cases: Case[] };

describe('buildSuccessionKpis — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => expect(buildSuccessionKpis(c.input.counts)).toEqual(c.expected));
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(3));
});
