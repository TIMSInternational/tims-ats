import { describe, it, expect } from 'vitest';
import {
  scoreChoice,
  computeResult,
  answerInputSchema,
  submitAssessmentAnswersSchema,
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
