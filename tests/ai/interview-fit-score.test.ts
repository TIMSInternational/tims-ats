import { describe, it, expect } from 'vitest';
import { fitScoreOutputSchema } from '../../packages/ai/src/agents/interview-fit-score';

describe('interview-fit-score schema', () => {
  it('accepts score 0', () => {
    expect(() => fitScoreOutputSchema.parse({ score: 0, rationale: 'ok' })).not.toThrow();
  });

  it('accepts score 100', () => {
    expect(() => fitScoreOutputSchema.parse({ score: 100, rationale: 'excellent' })).not.toThrow();
  });

  it('accepts score 72', () => {
    const result = fitScoreOutputSchema.parse({ score: 72, rationale: 'good candidate' });
    expect(result.score).toBe(72);
  });

  it('rejects score 150', () => {
    expect(() => fitScoreOutputSchema.parse({ score: 150, rationale: 'too high' })).toThrow();
  });

  it('rejects score -1', () => {
    expect(() => fitScoreOutputSchema.parse({ score: -1, rationale: 'negative' })).toThrow();
  });

  it('rejects non-integer score', () => {
    expect(() => fitScoreOutputSchema.parse({ score: 72.5, rationale: 'float' })).toThrow();
  });

  it('rejects rationale over 2000 chars', () => {
    expect(() =>
      fitScoreOutputSchema.parse({ score: 50, rationale: 'x'.repeat(2001) }),
    ).toThrow();
  });

  it('accepts rationale at exactly 2000 chars', () => {
    expect(() =>
      fitScoreOutputSchema.parse({ score: 50, rationale: 'x'.repeat(2000) }),
    ).not.toThrow();
  });
});
