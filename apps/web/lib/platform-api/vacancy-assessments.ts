'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { platformGet, platformSendRaw, PlatformApiError } from './client';
import { fitRequirementIssueSchema, isFitEngineV2Enabled } from './fit-engine';

// FIT v2 — the vacancy assessments editor reads and writes ONLY fit_requirements.assessments[] through C#
// (GET/PUT /fit-engine/vacancies/{id}/requirements/assessments, mapped with the requirements writer). The write is
// conditional on the version the editor read: a concurrent change is a 409 that carries what is stored now.

export const FIT_REQUIREMENT_INSTRUMENTS = [
  'lia',
  'english',
  'itcia',
  'personality',
  'mi',
  'pca',
  'native_quiz',
] as const;
export type FitRequirementInstrument = (typeof FIT_REQUIREMENT_INSTRUMENTS)[number];
export const INSTRUMENT_USES = ['scored', 'gate', 'advisory'] as const;
export type InstrumentUse = (typeof INSTRUMENT_USES)[number];
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

const minimumSchema = z
  .object({
    globalPercentile: z.number().min(0).max(100).nullable(),
    cefr: z.enum(CEFR_LEVELS).nullable(),
    level: z.number().int().min(1).max(5).nullable(),
    score: z.number().min(0).max(100).nullable(),
    // PCA: the minimum on the provider's job fit (0–100).
    jobFit: z.number().min(0).max(100).nullable(),
  })
  .strict();

/** A TIMS position code (contract JobCode): 2 to 30 letters, digits, `_` or `-`, matched by TIMS as given. */
export const JOB_CODE_PATTERN = /^[A-Za-z0-9_-]{2,30}$/;

export const requirementSchema = z
  .object({
    instrument: z.enum(FIT_REQUIREMENT_INSTRUMENTS),
    use: z.enum(INSTRUMENT_USES),
    min: minimumSchema.nullable(),
    weight: z.number().positive().max(100).nullable(),
    reason: z.string().max(500).nullable(),
    // PCA only: the vacancy's TIMS position code, against which TIMS computes the PCA-vs-JCA fit.
    jobCode: z.string().regex(JOB_CODE_PATTERN).nullable(),
  })
  .strict();

const responseSchema = z
  .object({
    assessments: z.array(requirementSchema).max(32),
    version: z.string().regex(/^[0-9a-f]{32}$/),
    issues: z.array(fitRequirementIssueSchema).max(64),
  })
  .strict();

const conflictSchema = z.object({ error: z.literal('requirements_changed'), current: responseSchema }).strict();

export type AssessmentRequirement = z.infer<typeof requirementSchema>;
export type AssessmentRequirementMinimum = z.infer<typeof minimumSchema>;
export type VacancyAssessments = z.infer<typeof responseSchema>;

/** The body the editor sends: each entry exactly as configured (the server refuses anything it would drop). */
export interface AssessmentRequirementInput {
  instrument: FitRequirementInstrument;
  use: InstrumentUse;
  min?: { globalPercentile?: number; cefr?: CefrLevel; level?: number; score?: number; jobFit?: number };
  weight?: number;
  reason: string;
  jobCode?: string;
}

export const vacancyAssessmentsKey = (vacancyId: string) => ['platform', 'vacancy-assessments', vacancyId] as const;

/** GET …/requirements/assessments — the configured instruments, the version to send back, and ignored entries. */
export function useVacancyAssessments(vacancyId: string, enabled = true) {
  return useQuery({
    queryKey: vacancyAssessmentsKey(vacancyId),
    enabled: enabled && isFitEngineV2Enabled(),
    retry: false,
    queryFn: async (): Promise<VacancyAssessments> =>
      responseSchema.parse(
        await platformGet('/fit-engine/vacancies/{vacancyId}/requirements/assessments', undefined, { vacancyId }),
      ),
  });
}

/** Thrown when the array changed since the editor read it; `current` is what is stored now. */
export class VacancyAssessmentsConflict extends Error {
  readonly current: VacancyAssessments;

  constructor(current: VacancyAssessments) {
    super('requirements_changed');
    this.name = 'VacancyAssessmentsConflict';
    this.current = current;
  }
}

/**
 * PUT …/requirements/assessments, conditional on `version`. Resolves with what was stored (and the notes, e.g.
 * `lia_threshold_only`); rejects with {@link VacancyAssessmentsConflict} on a concurrent change (the cache is updated to
 * the current array), or with the platform error otherwise.
 */
export function useSaveVacancyAssessments(vacancyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ assessments, version }: { assessments: AssessmentRequirementInput[]; version: string }) => {
      if (!isFitEngineV2Enabled()) throw new Error('FIT v2 is not enabled');
      try {
        return responseSchema.parse(
          await platformSendRaw(
            'PUT',
            '/fit-engine/vacancies/{vacancyId}/requirements/assessments',
            { assessments, expectedVersion: version },
            { vacancyId },
          ),
        );
      } catch (error) {
        if (error instanceof PlatformApiError && error.status === 409) {
          const conflict = conflictSchema.safeParse(error.body);
          if (conflict.success) throw new VacancyAssessmentsConflict(conflict.data.current);
        }
        throw error;
      }
    },
    onSuccess: (saved) => queryClient.setQueryData(vacancyAssessmentsKey(vacancyId), saved),
    onError: (error) => {
      if (error instanceof VacancyAssessmentsConflict) {
        queryClient.setQueryData(vacancyAssessmentsKey(vacancyId), error.current);
      }
    },
  });
}
