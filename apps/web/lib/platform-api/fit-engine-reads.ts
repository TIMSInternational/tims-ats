'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { platformGet, platformPost } from './client';
import { isFitEngineV2Enabled } from './fit-engine';

// FIT v2: the fit-engine READS the web app makes, served by C# under NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP (the same flag
// as the requirements card and essay grading; set it only with Platform__FitEngineReadEnabled,
// Platform__FitEngineWriteEnabled and Platform__FitEngineV2Enabled). The C# reads apply owner default D6 for a team
// leader (only "below minimum", never the level, and an overall that cannot be inverted back to it). Flag off: every
// hook here is disabled and the callers keep their tRPC queries, unchanged. explainFit stays on tRPC: its narrative
// comes from the Bedrock pipeline, which has no C# plane (the C# route answers 501); its input is redacted there.

/** A stored breakdown as the C# reads return it: a JSON object (v1 or v2), narrowed by the components that render it. */
const breakdownSchema = z.record(z.string(), z.unknown()).nullable();

const rankingRowSchema = z
  .object({
    fitScoreId: z.string().uuid(),
    candidateId: z.string().uuid(),
    firstName: z.string().max(500),
    lastName: z.string().max(500),
    overallScore: z.number(),
    breakdown: breakdownSchema,
    isPartial: z.boolean(),
    calculatedAt: z.string().max(64),
  })
  .strict();

export type FitRankingRow = z.infer<typeof rankingRowSchema>;

const MAX_ROWS = 5_000;
const rankingSchema = z.array(rankingRowSchema).max(MAX_ROWS);

const rankingKey = (vacancyId: string) => ['platform', 'fit-ranking', vacancyId] as const;

/** GET /fit-engine/vacancies/{id}/ranking — the vacancy's stored FIT rows, overall DESC (D6-redacted for a leader). */
export function useFitRankingViaCsharp(vacancyId: string) {
  return useQuery({
    queryKey: rankingKey(vacancyId),
    enabled: isFitEngineV2Enabled(),
    retry: false,
    queryFn: async (): Promise<FitRankingRow[]> =>
      rankingSchema.parse(await platformGet('/fit-engine/vacancies/{vacancyId}/ranking', undefined, { vacancyId })),
  });
}

const simulatedSchema = z
  .array(
    z
      .object({
        candidateId: z.string().uuid(),
        firstName: z.string().max(500),
        lastName: z.string().max(500),
        simulatedScore: z.number(),
        isPartial: z.boolean(),
      })
      .strict(),
  )
  .max(MAX_ROWS);

export type FitDimensionWeights = Record<'assessment' | 'interview' | 'experience' | 'education' | 'languages', number>;

/** GET …/simulate-weights — the what-if ranking over the stored breakdowns. Manual (`refetch`), like the tRPC query. */
export function useSimulateWeightsViaCsharp(vacancyId: string, weights: FitDimensionWeights) {
  return useQuery({
    queryKey: ['platform', 'fit-simulate', vacancyId, weights] as const,
    enabled: false,
    retry: false,
    queryFn: async () => {
      if (!isFitEngineV2Enabled()) throw new Error('FIT v2 is not enabled');
      const query = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, String(v)]));
      return simulatedSchema.parse(
        await platformGet('/fit-engine/vacancies/{vacancyId}/simulate-weights', query, { vacancyId }),
      );
    },
  });
}

/** POST /fit-engine/vacancies/{id}/compute — the C# compute (v2 for a vacancy with assessments), then a fresh ranking. */
export function useComputeForVacancyViaCsharp(
  vacancyId: string,
  options?: { onSuccess?: (computed: number) => void; onError?: (error: Error) => void },
) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async () => {
      if (!isFitEngineV2Enabled()) throw new Error('FIT v2 is not enabled');
      return z
        .object({ computed: z.number().int().min(0) })
        .strict()
        .parse(await platformPost('/fit-engine/vacancies/{vacancyId}/compute', undefined, { vacancyId }));
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: rankingKey(vacancyId) });
      options?.onSuccess?.(result.computed);
    },
    onError: (error: Error) => options?.onError?.(error),
  });
}

const candidateFitScoreSchema = z
  .object({
    fitScoreId: z.string().uuid(),
    vacancyId: z.string().uuid(),
    overallScore: z.number(),
    breakdown: breakdownSchema,
    isPartial: z.boolean(),
    calculatedAt: z.string().max(64),
  })
  .strict();

const candidateFitScoresSchema = z.object({ items: z.array(candidateFitScoreSchema).max(100) }).strict();

/** One fit score in the shape the candidate page renders (the shape of `candidate.getById`'s `fitScores`). */
export interface CandidatePageFitScore {
  id: string;
  overallScore: number;
  breakdown: Record<string, unknown> | null;
  calculatedAt: Date;
}

/** GET /fit-engine/candidates/{id}/fit-scores — the candidate's fit scores this reader may see, most recent first. */
export function useCandidateFitScoresViaCsharp(candidateId: string) {
  return useQuery({
    queryKey: ['platform', 'candidate-fit-scores', candidateId] as const,
    enabled: isFitEngineV2Enabled(),
    retry: false,
    queryFn: async (): Promise<CandidatePageFitScore[]> =>
      candidateFitScoresSchema
        .parse(await platformGet('/fit-engine/candidates/{candidateId}/fit-scores', undefined, { candidateId }))
        .items.map((row) => ({
          id: row.fitScoreId,
          overallScore: row.overallScore,
          breakdown: row.breakdown,
          calculatedAt: new Date(row.calculatedAt),
        })),
  });
}

/**
 * The candidate page's `fitScores`: flag on, ONLY the C# read (empty while it loads or if it fails, so the page never
 * falls back to the unredacted TS payload); flag off, the `candidate.getById` rows as before.
 */
export function withCandidatePageFitScores<T extends { fitScores: unknown[] }>(
  candidate: T,
  csharp: { data?: CandidatePageFitScore[] },
): T {
  if (!isFitEngineV2Enabled()) return candidate;
  return { ...candidate, fitScores: (csharp.data ?? []) as unknown as T['fitScores'] };
}
