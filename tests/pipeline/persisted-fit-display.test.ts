import { describe, expect, it } from 'vitest';
import { getPipelineFit, meetsPipelineFitThreshold } from '../../apps/web/lib/pipeline-fit';

describe('pipeline FIT display and filtering', () => {
  it('has no score before a FIT result has been calculated', () => {
    expect(getPipelineFit({ fitScores: [] })).toBeNull();
    expect(getPipelineFit({ fitScores: [{ overallScore: Number.NaN, isPartial: false }] })).toBeNull();
  });

  it('uses the persisted score and preserves its partial-result warning', () => {
    expect(getPipelineFit({ fitScores: [{ overallScore: 82, isPartial: true }] })).toEqual({
      score: 82,
      isPartial: true,
    });
  });

  it('excludes unscored candidates from a FIT threshold', () => {
    expect(meetsPipelineFitThreshold({ fitScores: [] }, 75)).toBe(false);
    expect(meetsPipelineFitThreshold({ fitScores: [{ overallScore: 74, isPartial: false }] }, 75)).toBe(false);
    expect(meetsPipelineFitThreshold({ fitScores: [{ overallScore: 80, isPartial: true }] }, 75)).toBe(false);
    expect(meetsPipelineFitThreshold({ fitScores: [{ overallScore: 80, isPartial: false }] }, 75)).toBe(true);
  });
});
