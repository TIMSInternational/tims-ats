/**
 * kernels-fixtures.test.ts — Phase-5 nine-box strangler, Slice 10.
 *
 * Asserts the REAL @tims/shared nine-box kernels (the SAME ones the ninebox router now returns) against
 * the shared golden contracts/ninebox-fixtures/*.json — the SAME fixtures the C# NineBoxKernels unit
 * tests assert. Anti-drift: any divergence in either stack (band thresholds, quadrant-plan Spanish
 * content, half-up benchStrength ratio, distribution counts) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  simulateBands,
  resolveQuadrantPlan,
  buildBenchStrength,
  buildQuadrantDistribution,
  gridPlacement,
  computeMovements,
  type MovementEvalInput,
} from '@tims/shared';

interface Case {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

const load = (file: string): Case[] =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'ninebox-fixtures', file), 'utf8')).cases;

describe('nine-box kernels — golden parity (real @tims/shared exports)', () => {
  it('simulateBands', () => {
    for (const c of load('simulate-bands.json')) {
      expect(simulateBands(c.input.pot as number, c.input.perf as number), c.name).toEqual(c.expected);
    }
  });

  it('resolveQuadrantPlan', () => {
    for (const c of load('quadrant-plan.json')) {
      expect(resolveQuadrantPlan(c.input.quadrant as string), c.name).toEqual(c.expected);
    }
  });

  it('buildBenchStrength', () => {
    for (const c of load('bench-strength.json')) {
      expect(buildBenchStrength(c.input.quadrants as string[]), c.name).toEqual(c.expected);
    }
  });

  it('buildQuadrantDistribution', () => {
    for (const c of load('quadrant-distribution.json')) {
      expect(buildQuadrantDistribution(c.input.quadrants as string[]), c.name).toEqual(c.expected);
    }
  });

  it('gridPlacement', () => {
    for (const c of load('grid-placement.json')) {
      const items = c.input.items as Array<{ id: string; quadrant: string }>;
      expect(gridPlacement(items, (i) => i.quadrant), c.name).toEqual(c.expected);
    }
  });

  it('computeMovements', () => {
    for (const c of load('movements.json')) {
      expect(computeMovements(c.input.evaluations as MovementEvalInput[]), c.name).toEqual(c.expected);
    }
  });
});
