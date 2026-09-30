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
