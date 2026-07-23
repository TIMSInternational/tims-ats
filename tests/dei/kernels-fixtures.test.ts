/**
 * kernels-fixtures.test.ts — Phase-5 people-dashboards strangler, Slice 11b (DEI, GROUP 2).
 *
 * Asserts the REAL @tims/shared DEI kernels (the SAME ones the dei service/router now call) against the shared
 * golden contracts/dei-fixtures/*.json — the SAME fixtures the C# DeiKernels unit tests assert. Anti-drift: any
 * divergence in either stack (min-5 floors, present-key-cardinality empties, the cross-endpoint differencing
 * guard, half-up rounding, age-band boundaries, inclusion multi-tier suppression) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  pct,
  median,
  ageBand,
  buildDistribution,
  leadershipDiversity,
  deiDashboardKpis,
  inclusionIndex,
  type DistInput,
  type DashboardKpisInput,
} from '@tims/shared';

interface Case {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

const load = (file: string): Case[] =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'dei-fixtures', file), 'utf8')).cases;

describe('DEI kernels — golden parity (real @tims/shared exports)', () => {
  it('pct', () => {
    for (const c of load('pct.json')) {
      const i = c.input as { count: number; total: number };
      expect(pct(i.count, i.total), c.name).toEqual(c.expected);
    }
  });

  it('median', () => {
    for (const c of load('median.json')) {
      const i = c.input as { values: number[] };
      expect(median(i.values), c.name).toEqual(c.expected);
    }
  });

  it('ageBand', () => {
    for (const c of load('age-band.json')) {
      const i = c.input as { dob: string; now: string };
      // Construct as local-midnight so getFullYear/getMonth/getDate are the calendar Y/M/D of the string
      // (parity with the C# DateTime.Parse date-only path).
      expect(ageBand(new Date(`${i.dob}T00:00:00`), new Date(`${i.now}T00:00:00`)), c.name).toEqual(c.expected);
    }
  });

  it('buildDistribution', () => {
    for (const c of load('build-distribution.json')) {
      const i = c.input as { groups: DistInput[]; total: number; extraBuckets: number[] };
      expect(buildDistribution(i.groups, i.total, i.extraBuckets), c.name).toEqual(c.expected);
    }
  });

  it('leadershipDiversity', () => {
    for (const c of load('leadership-diversity.json')) {
      const i = c.input as { leaderGenders: string[] };
      expect(leadershipDiversity(i.leaderGenders), c.name).toEqual(c.expected);
    }
  });

  it('deiDashboardKpis', () => {
    for (const c of load('dashboard-kpis.json')) {
      expect(deiDashboardKpis(c.input as unknown as DashboardKpisInput), c.name).toEqual(c.expected);
    }
  });

  it('inclusionIndex', () => {
    for (const c of load('inclusion-index.json')) {
      const i = c.input as {
        questions: Array<Record<string, unknown>>;
        responses: Array<{ answers: Record<string, unknown> | null }>;
      };
      expect(inclusionIndex(i.questions, i.responses), c.name).toEqual(c.expected);
    }
  });
});
