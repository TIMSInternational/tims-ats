/**
 * kernels-fixtures.test.ts — Phase-5 fit-engine strangler, Slice 24 (#90).
 *
 * Asserts the REAL fit-engine pure kernels (the SAME exports the fitEngine router computes with) against
 * the shared golden contracts/fit-engine-fixtures/*.json — the SAME fixtures the C# FitEngineKernels unit
 * tests assert. Anti-drift: any divergence in either stack (renormalization, the all-zero-weights quirk,
 * JS half-up rounding, the education keyword ladder, parenthetical language stripping, lenient
 * requirements parsing) turns this red. js-round.json pins Math.round itself — including the
 * 0.49999999999999994 edge (stays 0) and -0.5 (→ -0, serialized 0) — because the C# JsRound must
 * reproduce it exactly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  computeWeightedScore,
  deriveExperienceScore,
  deriveEducationScore,
  deriveLanguageScore,
  parseRequirements,
  type FitDimension,
  type Requirements,
} from '../../packages/api/src/services/fit-engine.service';

interface Case {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

const load = (file: string): Case[] =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'fit-engine-fixtures', file), 'utf8')).cases;

describe('fit-engine kernels — golden parity (real service exports)', () => {
  it('computeWeightedScore', () => {
    for (const c of load('weighted-score.json')) {
      const actual = computeWeightedScore(
        c.input.rawScores as Record<FitDimension, number | null>,
        c.input.weights as Record<FitDimension, number>,
      );
      expect(actual, c.name).toEqual(c.expected);
    }
  });

  it('deriveExperienceScore', () => {
    for (const c of load('experience-score.json')) {
      const actual = deriveExperienceScore(
        c.input.yearsExperience as number | null,
        c.input.requirements as Requirements,
      );
      expect(actual, c.name).toEqual(c.expected);
    }
  });

  it('deriveEducationScore', () => {
    for (const c of load('education-score.json')) {
      const actual = deriveEducationScore(
        c.input.education as Array<{ degree?: unknown }> | null,
        c.input.requirements as Requirements,
      );
      expect(actual, c.name).toEqual(c.expected);
    }
  });

  it('deriveLanguageScore', () => {
    for (const c of load('language-score.json')) {
      const actual = deriveLanguageScore(c.input.languages as string[] | null, c.input.requirements as Requirements);
      expect(actual, c.name).toEqual(c.expected);
    }
  });

  it('parseRequirements', () => {
    for (const c of load('parse-requirements.json')) {
      // toEqual is strict about PRESENT keys; parseRequirements omits absent fields exactly as the
      // fixture's expected objects do (JSON.stringify dropped them at generation).
      expect(parseRequirements(c.input.raw), c.name).toEqual(c.expected);
    }
  });

  it('Math.round is the js-round oracle', () => {
    for (const c of load('js-round.json')) {
      // `+ 0` normalizes -0 → 0 (Math.round(-0.5) IS -0; JSON serialized it as 0, and toBe would
      // distinguish them via Object.is).
      expect(Math.round(c.input.value as number) + 0, c.name).toBe(c.expected);
    }
  });
});
