import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fitScoreAsShown,
  hidesBelowMinimum,
  redactFitBreakdownBelowMinimum,
  redactFitScoreForNarrowReader,
  weightedOverallScore,
} from '../../packages/ai/src/fit-visibility';

// Owner default D6: the TS twin of the C# FitV2Visibility + overall recompute. Both stacks run the SAME hand-derived
// cases (contracts/fit-v2-fixtures/visibility.json; the C# half is FitV2IntegrityTests in Tims.UnitTests), so a TS read
// and a C# read of one stored row show a team leader exactly the same thing.
interface VisibilityCase {
  name: string;
  input: { overallScore: number; isPartial: boolean; weights: unknown; breakdown: unknown };
  expected: { redacted: boolean; overallScore: number; isPartial: boolean; breakdown: unknown };
}
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/fit-v2-fixtures/visibility.json'), 'utf8'),
) as { cases: VisibilityCase[] };

describe('fit-visibility (owner default D6)', () => {
  it('has the shared cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const shown = redactFitScoreForNarrowReader({ ...c.input });
      expect(shown.breakdown).toEqual(c.expected.breakdown);
      expect(shown.overallScore).toBe(c.expected.overallScore);
      expect(shown.isPartial).toBe(c.expected.isPartial);
      expect(redactFitBreakdownBelowMinimum(c.input.breakdown).redacted).toBe(c.expected.redacted);
      // The input row is never mutated.
      expect(c.input.breakdown).toEqual(fixture.cases.find((x) => x.name === c.name)!.input.breakdown);
    });
  }

  it('only company and organization scope see the stored row; anything else, unknown included, is redacted', () => {
    expect(hidesBelowMinimum('organization')).toBe(false);
    expect(hidesBelowMinimum('company')).toBe(false);
    for (const scope of ['unit', 'team', 'own', 'all', '', null, undefined]) {
      expect(hidesBelowMinimum(scope)).toBe(true);
    }
  });

  it('fitScoreAsShown never returns weights, and adds isPartial only to a row that had the key', () => {
    const c = fixture.cases[0]!;
    const withoutPartial = {
      id: 'f1',
      overallScore: c.input.overallScore,
      breakdown: c.input.breakdown,
      weights: c.input.weights,
    };
    const narrow = fitScoreAsShown(withoutPartial, true);
    expect(narrow).toEqual({ id: 'f1', overallScore: c.expected.overallScore, breakdown: c.expected.breakdown });
    expect('weights' in narrow).toBe(false);
    expect('isPartial' in narrow).toBe(false);
    const wide = fitScoreAsShown(withoutPartial, false);
    expect(wide).toEqual({ id: 'f1', overallScore: c.input.overallScore, breakdown: c.input.breakdown });
  });

  it('weightedOverallScore is the fit engine kernel: renormalized over present dimensions, rounded half up', () => {
    expect(weightedOverallScore({ assessment: 50, interview: 51 }, { assessment: 0.5, interview: 0.5 })).toEqual({
      overallScore: 51, // 50.5 → 51 (Math.round, the C# JsRound)
      isPartial: true,
    });
    expect(
      weightedOverallScore({ assessment: '90', interview: 60 }, { assessment: 0.5, interview: 0.5 }).overallScore,
    ).toBe(60);
    expect(weightedOverallScore({}, { assessment: 1 })).toEqual({ overallScore: 0, isPartial: true });
  });
});
