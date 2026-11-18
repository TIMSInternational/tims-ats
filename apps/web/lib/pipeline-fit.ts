export interface PipelineFitCandidate {
  fitScores?: ReadonlyArray<{ overallScore: number; isPartial: boolean }>;
}

export function getPipelineFit(candidate: PipelineFitCandidate | null | undefined) {
  const fit = candidate?.fitScores?.[0];
  if (!fit || !Number.isFinite(fit.overallScore) || fit.overallScore < 0 || fit.overallScore > 100) {
    return null;
  }
  return { score: fit.overallScore, isPartial: fit.isPartial };
}

export function meetsPipelineFitThreshold(candidate: PipelineFitCandidate | null | undefined, minimum: number) {
  const fit = getPipelineFit(candidate);
  return fit !== null && !fit.isPartial && fit.score >= minimum;
}

/**
 * One FIT colour scale for the board, the list, the table, the filter and the Candidate 360 (A-23): they
 * used to disagree (75/50 on the board, 70/40 on the 360), so the same score showed two colours.
 */
export const FIT_BANDS = { high: 70, medium: 40 } as const;

export type FitBand = 'high' | 'medium' | 'low';

export function fitBand(score: number): FitBand {
  if (score >= FIT_BANDS.high) return 'high';
  if (score >= FIT_BANDS.medium) return 'medium';
  return 'low';
}
