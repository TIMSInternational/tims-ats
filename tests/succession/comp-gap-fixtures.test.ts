/**
 * comp-gap-fixtures.test.ts — Phase-5 succession strangler, Slice 8.
 *
 * Asserts the REAL @tims/shared buildCompGapAlerts (the same detection loop succession.getCompGapAlerts
 * uses) against contracts/succession-fixtures/comp-gap.json — the SAME fixture the C#
 * SuccessionKernels.BuildCompGapAlerts unit tests assert. Pins threshold, half-up gapPercent, skip rules,
 * and the exposed-only auditedCompIds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildCompGapAlerts,
  type CompGapRoleInput,
  type CompGapBandInput,
  type CompGapCompInput,
  type CompGapResult,
} from '@tims/shared';

interface Case {
  name: string;
  input: { roles: CompGapRoleInput[]; bands: CompGapBandInput[]; comps: CompGapCompInput[] };
  expected: CompGapResult;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'succession-fixtures', 'comp-gap.json'), 'utf8'),
) as { cases: Case[] };

describe('buildCompGapAlerts — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () =>
      expect(buildCompGapAlerts(c.input.roles, c.input.bands, c.input.comps)).toEqual(c.expected));
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(3));
});
