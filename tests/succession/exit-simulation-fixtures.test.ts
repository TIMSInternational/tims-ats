/**
 * exit-simulation-fixtures.test.ts — Phase-5 succession strangler, Slice 8.
 *
 * Asserts the REAL @tims/shared buildExitSimulation (the same builder succession.simulateExit returns)
 * against contracts/succession-fixtures/exit-simulation.json — the SAME fixture the C#
 * SuccessionKernels.BuildExitSimulation unit tests assert. Pins risk tiers + FIRST-ready_now naming.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildExitSimulation, type ExitSuccessorInput, type ExitSimulation } from '@tims/shared';

interface Case {
  name: string;
  input: { successors: ExitSuccessorInput[] };
  expected: ExitSimulation;
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'succession-fixtures', 'exit-simulation.json'), 'utf8'),
) as { cases: Case[] };

describe('buildExitSimulation — golden parity (asserted identically by the C# port)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => expect(buildExitSimulation(c.input.successors)).toEqual(c.expected));
  }
  it('has cases', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(3));
});
