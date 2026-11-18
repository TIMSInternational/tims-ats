'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isPlatformApiEnabled, platformGet, platformPost, platformSendRaw } from './client';

// FIT v2 (per-instrument fit) lives ONLY in C#. Dark unless BOTH the C# base URL and this opt-in flag are set; set it
// only together with Platform__FitEngineV2Enabled, Platform__FitEngineWriteEnabled and Platform__FitEngineReadEnabled,
// so the requirements card and the C# compute agree on who writes fit_requirements.
const VIA_CSHARP = process.env.NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP === 'true';

export function isFitEngineV2Enabled(): boolean {
  return VIA_CSHARP && isPlatformApiEnabled();
}

/**
 * True only when a stored FIT breakdown says its score is provisional (`reviewPending: true`): a result it counts on
 * awaits review, so the number may change. A v1 breakdown, or anything malformed, is not pending.
 */
export function isReviewPending(breakdown: unknown): boolean {
  return (
    typeof breakdown === 'object' &&
    breakdown !== null &&
    !Array.isArray(breakdown) &&
    (breakdown as Record<string, unknown>).reviewPending === true
  );
}

// ── review state for list views (candidate table, talent-pool table) ──

const MAX_REVIEW_IDS = 100;

const reviewStateResponseSchema = z
  .object({
    items: z
      .array(z.object({ fitScoreId: z.string().uuid(), reviewPending: z.boolean() }).strict())
      .max(MAX_REVIEW_IDS),
  })
  .strict();

/** The ids of the fit scores that are provisional, among those given (at most 100: one table page). */
export function useReviewPendingFitScores(fitScoreIds: readonly string[]) {
  const ids = [...new Set(fitScoreIds)].sort().slice(0, MAX_REVIEW_IDS);
  return useQuery({
    queryKey: ['platform', 'fit-review-state', ids] as const,
    enabled: isFitEngineV2Enabled() && ids.length > 0,
    retry: false,
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const parsed = reviewStateResponseSchema.parse(
        await platformPost('/fit-engine/scores/review-state', { fitScoreIds: ids }),
      );
      return new Set(parsed.items.filter((i) => i.reviewPending).map((i) => i.fitScoreId));
    },
  });
}

// ── the requirements writer ──

export const fitRequirementIssueSchema = z
  .object({
    index: z.number().int().min(0),
    instrument: z.string().max(32).nullable(),
    code: z.string().max(64),
    dropped: z.boolean(),
  })
  .strict();

const fitRequirementsResponseSchema = z
  .object({
    fitRequirements: z.record(z.string(), z.unknown()).nullable(),
    issues: z.array(fitRequirementIssueSchema).max(128),
  })
  .strict();

export type FitRequirementIssue = z.infer<typeof fitRequirementIssueSchema>;

export interface FitRequirementsInput {
  minYearsExperience?: number;
  requiredEducationLevel?: string;
  requiredLanguages?: string[];
}

/**
 * PUT /fit-engine/vacancies/{id}/requirements. It never sends `assessments`, so the C# writer keeps the stored array
 * (the TS mutation replaces the whole object and erases it). Resolves with the findings the writer reports.
 */
export function useUpdateFitRequirementsViaCsharp(options?: {
  onSuccess?: (issues: FitRequirementIssue[]) => void;
  onError?: (error: Error) => void;
}) {
  return useMutation({
    retry: false,
    mutationFn: async (input: FitRequirementsInput & { vacancyId: string }) => {
      if (!isFitEngineV2Enabled()) throw new Error('FIT v2 is not enabled');
      const { vacancyId, ...body } = input;
      return fitRequirementsResponseSchema.parse(
        await platformSendRaw('PUT', '/fit-engine/vacancies/{vacancyId}/requirements', body, { vacancyId }),
      );
    },
    onSuccess: (response) => options?.onSuccess?.(response.issues),
    onError: (error: Error) => options?.onError?.(error),
  });
}

// ── essay grading (owner default D5) ──

const pendingEssaysSchema = z
  .object({
    essays: z
      .array(
        z
          .object({
            questionId: z.string().uuid(),
            prompt: z.string().max(10_000),
            answer: z.string().max(100_000),
            maxPoints: z.number().min(0),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export type PendingEssay = z.infer<typeof pendingEssaysSchema>['essays'][number];

const essaysKey = (assignmentId: string) => ['platform', 'pending-essays', assignmentId] as const;

/** GET /fit-engine/assignments/{id}/essays — the essays still awaiting a grade. */
export function usePendingEssays(assignmentId: string, enabled = true) {
  return useQuery({
    queryKey: essaysKey(assignmentId),
    enabled: enabled && isFitEngineV2Enabled(),
    retry: false,
    queryFn: async (): Promise<PendingEssay[]> =>
      pendingEssaysSchema.parse(
        await platformGet('/fit-engine/assignments/{assignmentId}/essays', undefined, { assignmentId }),
      ).essays,
  });
}

const gradedSchema = z
  .object({ remainingPending: z.number().int().min(0), normalizedScore: z.number().nullable() })
  .strict();

/** POST …/essays/{questionId}/grade. Refreshes the essay list on success. */
export function useGradeEssay(assignmentId: string, options?: { onError?: (error: Error) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ questionId, points }: { questionId: string; points: number }) => {
      if (!isFitEngineV2Enabled()) throw new Error('FIT v2 is not enabled');
      return gradedSchema.parse(
        await platformPost(
          '/fit-engine/assignments/{assignmentId}/essays/{questionId}/grade',
          { points },
          { assignmentId, questionId },
        ),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: essaysKey(assignmentId) }),
    onError: (error: Error) => options?.onError?.(error),
  });
}
