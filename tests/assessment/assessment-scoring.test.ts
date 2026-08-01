import { describe, it, expect } from 'vitest';
import {
  scoreChoice,
  computeResult,
  answerInputSchema,
  submitAssessmentAnswersSchema,
  MAX_FREE_TEXT,
  computeNormBand,
  MIN_NORM_SAMPLE_SIZE,
} from '../../packages/shared/src/validators/assessment';

describe('scoreChoice', () => {
  it('awards full points on exact set match (single_choice)', () => {
    expect(scoreChoice(['b'], ['b'], 5)).toEqual({ isCorrect: true, pointsAwarded: 5 });
  });

  it('is order-independent for multi_choice', () => {
    expect(scoreChoice(['b', 'a'], ['a', 'b'], 10)).toEqual({ isCorrect: true, pointsAwarded: 10 });
  });

  it('awards zero on a partial multi_choice match (no partial credit)', () => {
    expect(scoreChoice(['a'], ['a', 'b'], 10)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it('awards zero on an extra incorrect selection', () => {
    expect(scoreChoice(['a', 'b', 'c'], ['a', 'b'], 10)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it('awards zero on an empty selection', () => {
    expect(scoreChoice([], ['a'], 5)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });
});

describe('computeResult', () => {
  it('sums raw score and normalizes over the auto-scorable subset only', () => {
    const result = computeResult([
      { isCorrect: true, pointsAwarded: 5, points: 5 },
      { isCorrect: false, pointsAwarded: 0, points: 5 },
    ]);
    expect(result).toEqual({ rawScore: 5, normalizedScore: 50, hasPending: false });
  });

  it('excludes free_text (null) questions from the normalized-score denominator', () => {
    const result = computeResult([
      { isCorrect: true, pointsAwarded: 5, points: 5 },
      { isCorrect: null, pointsAwarded: null, points: 20 },
    ]);
    expect(result).toEqual({ rawScore: 5, normalizedScore: 100, hasPending: true });
  });

  it('returns 0 normalizedScore (not NaN) when everything is pending', () => {
    const result = computeResult([{ isCorrect: null, pointsAwarded: null, points: 20 }]);
    expect(result).toEqual({ rawScore: 0, normalizedScore: 0, hasPending: true });
  });
});

describe('computeNormBand', () => {
  it('returns null when the population is below MIN_NORM_SAMPLE_SIZE', () => {
    expect(computeNormBand(80, [70, 75, 90, 60])).toBeNull(); // 4 < 5
  });

  it('returns null for an empty population', () => {
    expect(computeNormBand(80, [])).toBeNull();
  });

  it('computes below_average for a score at the bottom of a 5+ population', () => {
    expect(computeNormBand(10, [20, 30, 40, 50, 60])).toEqual({ percentile: 0, band: 'below_average' });
  });

  it('computes excellent for a score at the top of a 5+ population', () => {
    expect(computeNormBand(100, [20, 30, 40, 50, 60])).toEqual({ percentile: 100, band: 'excellent' });
  });

  it('computes average for a score in the middle (25-50th percentile band)', () => {
    // candidate scores 45: 2 of 6 population strictly below (20,30), 0 equal
    // percentile = (2 + 0.5*0) / 6 * 100 = 33.33 -> average band [25,50)
    const result = computeNormBand(45, [20, 30, 50, 60, 70, 80]);
    expect(result?.band).toBe('average');
    expect(result?.percentile).toBeCloseTo(33.33, 1);
  });

  it('computes above_average for a score in the 50-75th percentile band', () => {
    // candidate scores 65: 4 of 6 below (20,30,50,60), percentile = 4/6*100 = 66.67 -> above_average
    const result = computeNormBand(65, [20, 30, 50, 60, 70, 80]);
    expect(result?.band).toBe('above_average');
    expect(result?.percentile).toBeCloseTo(66.67, 1);
  });

  it('splits a tie using the midpoint-rank formula (ties do not favor either side)', () => {
    // candidate scores 50, population has two other 50s among 5 total.
    // countBelow=0 (nothing strictly below 50), countEqual=2 -> (0 + 0.5*2)/5*100 = 20
    const result = computeNormBand(50, [50, 50, 60, 70, 80]);
    expect(result?.percentile).toBeCloseTo(20, 1);
  });

  it('is exactly MIN_NORM_SAMPLE_SIZE at the boundary (5 population members is enough)', () => {
    expect(computeNormBand(50, [10, 20, 30, 40, 60])).not.toBeNull();
  });
});

describe('MIN_NORM_SAMPLE_SIZE', () => {
  it('is 5', () => {
    expect(MIN_NORM_SAMPLE_SIZE).toBe(5);
  });
});

describe('answerInputSchema / submitAssessmentAnswersSchema', () => {
  it('accepts a choice answer and a free-text answer', () => {
    expect(
      answerInputSchema.parse({ questionId: '11111111-1111-1111-1111-111111111111', selectedOptionIds: ['a'] }),
    ).toBeTruthy();
    expect(
      answerInputSchema.parse({ questionId: '11111111-1111-1111-1111-111111111111', freeText: 'my essay' }),
    ).toBeTruthy();
  });

  it('rejects a submission with zero answers', () => {
    expect(() => submitAssessmentAnswersSchema.parse([])).toThrow();
  });

  it('rejects free text over the bound', () => {
    expect(() =>
      answerInputSchema.parse({
        questionId: '11111111-1111-1111-1111-111111111111',
        freeText: 'x'.repeat(20001),
      }),
    ).toThrow();
  });
});

describe('MAX_FREE_TEXT', () => {
  it('is exported for the frontend free_text textarea bound to mirror', () => {
    expect(MAX_FREE_TEXT).toBe(20000);
  });
});
