/**
 * suggested-successors-fixtures.test.ts — Phase-5 succession strangler, Slice 8.
 *
 * Asserts the REAL @tims/shared buildSuggestedSuccessors (the same builder succession.getSuggestedSuccessors
 * returns) against contracts/succession-fixtures/suggested-successors.json — the SAME fixture the C#
 * SuccessionKernels.BuildSuggestedSuccessors unit tests assert. Pins first-seen dedup + ranking + filter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSuggestedSuccessors, type SuggestedEvaluationInput, type SuggestedSuccessor } from '@tims/shared';

interface Case {
  name: string;
  input: { evaluations: SuggestedEvaluationInput[]; existingUserIds: string[] };
  expected: SuggestedSuccessor[];
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'succession-fixtures', 'suggested-successors.json'), 'utf8'),
) as { cases: Case[] };

describe('buildSuggestedSuccessors — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () =>
      expect(buildSuggestedSuccessors(c.input.evaluations, c.input.existingUserIds)).toEqual(c.expected));
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(3));
});
