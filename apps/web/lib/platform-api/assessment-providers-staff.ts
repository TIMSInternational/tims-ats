'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isPlatformApiEnabled, platformGet, platformPost, PlatformApiError } from './client';
import { CONSENT_PURPOSES } from './assessment-provider-portal';

// AS-7 / AS-14 — the HR and recruiter surfaces of the TIMS Assessments provider live ONLY in C# (no tRPC twin). Dark
// unless BOTH the C# base URL and this opt-in flag are set; the same flag gates the candidate portal's section. Enable
// it only with Platform__AssessmentProvidersEnabled on.
const VIA_CSHARP = process.env.NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP === 'true';

export function isProviderAssessmentsStaffEnabled(): boolean {
  return VIA_CSHARP && isPlatformApiEnabled();
}

export const PROVIDER_INSTRUMENTS = ['lia', 'english', 'itcia', 'personality', 'mi', 'pca'] as const;
export type ProviderInstrument = (typeof PROVIDER_INSTRUMENTS)[number];

export const STAFF_STATUSES = [
  'pending',
  'consent_needed',
  'sent',
  'in_progress',
  'scoring',
  'result_ready',
  'needs_review',
  'expired',
  'cancelled',
  'withdrawn',
  'erased',
] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const COUNTS_IN = ['assessment', 'languages', 'gate', 'advisory', 'not_listed'] as const;
export type CountsIn = (typeof COUNTS_IN)[number];

// ── catalog ──

const catalogSchema = z
  .object({
    connected: z.boolean(),
    instruments: z
      .array(
        z
          .object({
            instrument: z.enum(PROVIDER_INSTRUMENTS),
            delivery: z.enum(['native', 'link_out']),
            locales: z.array(z.string().max(5)).max(10),
            requiredConsents: z.array(z.enum(CONSENT_PURPOSES)).max(4),
            versions: z
              .array(z.object({ instrumentVersion: z.string().max(7), status: z.enum(['ga', 'beta']) }).strict())
              .max(20),
            pinnedVersion: z.string().max(7).nullable(),
          })
          .strict(),
      )
      .max(PROVIDER_INSTRUMENTS.length),
  })
  .strict();

export type StaffCatalog = z.infer<typeof catalogSchema>;
export type StaffCatalogInstrument = StaffCatalog['instruments'][number];

/** GET /assessments/provider-catalog — what this org may assign; with a vacancy, the version it is pinned to. */
export function useProviderCatalog(vacancyId?: string, enabled = true) {
  return useQuery({
    queryKey: ['platform', 'provider-catalog', vacancyId ?? null] as const,
    enabled: enabled && isProviderAssessmentsStaffEnabled(),
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StaffCatalog> =>
      catalogSchema.parse(await platformGet('/assessments/provider-catalog', { vacancyId })),
  });
}

// ── a candidate's attempts ──

// The shape behind a result (C# ProviderResultProfile): company-scope readers, valid results only. Exactly one member is
// set; every list and string is bounded, and nothing interpretive is part of it.
const profileKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const percent = z.number().min(0).max(100);
const cefrCode = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const pole = z.string().regex(/^[A-Z]$/);
const disc = z.number().int().min(0).max(100);

const profileSchema = z
  .object({
    lia: z
      .object({
        globalPercentile: percent.nullable(),
        globalLevel: profileKey.nullable(),
        normStatus: profileKey.nullable(),
        subtests: z
          .array(
            z
              .object({
                subtest: profileKey,
                percentile: percent.nullable(),
                level: profileKey.nullable(),
                completion: profileKey.nullable(),
              })
              .strict(),
          )
          .max(10),
      })
      .strict()
      .nullable()
      .optional(),
    english: z
      .object({
        overallCefr: cefrCode.nullable(),
        overallScorePct: percent.nullable(),
        skills: z
          .array(
            z
              .object({
                skill: profileKey,
                assessed: z.boolean(),
                cefr: cefrCode.nullable(),
                scorePct: percent.nullable(),
                notAssessedReason: profileKey.nullable(),
              })
              .strict(),
          )
          .max(10),
      })
      .strict()
      .nullable()
      .optional(),
    personality: z
      .object({
        variant: profileKey.nullable(),
        dimensions: z
          .array(
            z
              .object({
                dimension: profileKey,
                firstPole: pole,
                secondPole: pole,
                firstCount: z.number().int().min(0).max(1000),
                secondCount: z.number().int().min(0).max(1000),
                preferredPole: pole.nullable(),
                clarityPct: z.number().int().min(0).max(100),
                balanced: z.boolean(),
              })
              .strict(),
          )
          .max(8),
      })
      .strict()
      .nullable()
      .optional(),
    pca: z
      .object({
        primaryGraph: profileKey.nullable(),
        graphs: z.array(z.object({ graph: profileKey, d: disc, i: disc, s: disc, c: disc }).strict()).max(3),
        competencies: z
          .array(
            z
              .object({
                code: z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,79}$/),
                name: z.string().min(1).max(120),
                level: z.number().int().min(1).max(4),
                scaleMax: z.number().int().min(1).max(4),
              })
              .strict(),
          )
          .max(40),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type StaffResultProfile = z.infer<typeof profileSchema>;

const resultSchema = z
  .object({
    validity: z.enum(['valid', 'voided', 'needs_review']),
    validityReasons: z.array(z.string().max(64)).max(20).nullable(),
    requiresHumanReview: z.boolean(),
    reviewPending: z.boolean(),
    minimum: z.enum(['met', 'not_met', 'unknown']).nullable(),
    globalPercentile: z.number().min(0).max(100).nullable(),
    cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable(),
    level: z.number().int().min(1).max(5).nullable(),
    instrumentVersion: z.string().max(7),
    normVersion: z.string().max(64).nullable(),
    completedAt: z.string().max(40).datetime({ offset: true }),
    profile: profileSchema.nullable().optional(),
  })
  .strict();

export const SPEAKING_NOT_ASSESSED = ['no_voice_consent', 'no_ai_scoring_consent'] as const;

const attemptSchema = z
  .object({
    attemptId: z.string().uuid(),
    vacancyId: z.string().uuid(),
    instrument: z.enum(PROVIDER_INSTRUMENTS),
    status: z.enum(STAFF_STATUSES),
    instrumentVersion: z.string().max(7).nullable(),
    missingConsents: z.array(z.enum(CONSENT_PURPOSES)).max(4),
    expiresAt: z.string().max(40).datetime({ offset: true }).nullable(),
    createdAt: z.string().max(40).datetime({ offset: true }),
    completedAt: z.string().max(40).datetime({ offset: true }).nullable(),
    lastErrorCode: z.string().max(64).nullable(),
    timeMultiplier: z.number().min(1).max(3).nullable(),
    aids: z.array(z.string().max(32)).max(8).nullable(),
    countsIn: z.enum(COUNTS_IN),
    result: resultSchema.nullable(),
    /** English only: the candidate declined an optional purpose the speaking section needs. */
    speakingNotAssessed: z.enum(SPEAKING_NOT_ASSESSED).nullable().optional(),
  })
  .strict();

const attemptsSchema = z.object({ consentWithdrawn: z.boolean(), attempts: z.array(attemptSchema).max(100) }).strict();

export type StaffProviderAttempt = z.infer<typeof attemptSchema>;
export type StaffProviderResult = z.infer<typeof resultSchema>;
export type StaffAttemptList = z.infer<typeof attemptsSchema>;

export const providerAttemptsKey = (candidateId: string) => ['platform', 'provider-attempts', candidateId] as const;

/** GET /assessments/provider-attempts — the candidate's attempts as this reader may see them (D6 applied by C#). */
export function useCandidateProviderAttempts(candidateId: string) {
  return useQuery({
    queryKey: providerAttemptsKey(candidateId),
    enabled: isProviderAssessmentsStaffEnabled(),
    retry: false,
    queryFn: async (): Promise<StaffAttemptList> =>
      attemptsSchema.parse(await platformGet('/assessments/provider-attempts', { candidateId })),
  });
}

// ── assign ──

export const AGE_BANDS = ['18_plus', '16_17'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const ACCOMMODATION_AIDS = [
  'extended_breaks',
  'screen_reader',
  'screen_magnification',
  'high_contrast',
  'assistive_input',
  'captions_or_transcript',
  'reader_assistance',
  'separate_setting',
] as const;
export type AccommodationAid = (typeof ACCOMMODATION_AIDS)[number];

export const TIME_MULTIPLIERS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export interface AssignProviderInput {
  candidateId: string;
  vacancyId: string;
  instruments: ProviderInstrument[];
  ageBand: AgeBand;
  timeMultiplier: number;
  aids: AccommodationAid[];
}

const assignItemSchema = z
  .object({
    attemptId: z.string().uuid(),
    instrument: z.enum(PROVIDER_INSTRUMENTS),
    state: z.string().max(32),
    instrumentVersion: z.string().max(7).nullable(),
    requiredConsents: z.array(z.string().max(32)).max(4),
    expiresAt: z.string().max(40).nullable(),
    error: z.string().max(64).nullable(),
    locale: z.string().max(5),
    timeMultiplier: z.number(),
    aids: z.array(z.string().max(32)).max(8),
  })
  .strict();

const assignResponseSchema = z.object({ complete: z.boolean(), items: z.array(assignItemSchema).max(6) }).strict();

export type AssignResponse = z.infer<typeof assignResponseSchema>;

/** The stable reason an assignment was refused, from the route's `{ error }` body (else the HTTP status). */
export function assignErrorCode(error: unknown): string {
  if (error instanceof PlatformApiError) {
    const body = error.body;
    if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
      return (body as { error: string }).error.slice(0, 64);
    }
    if (error.status === 404) return 'not_found';
    if (error.status === 403) return 'forbidden';
  }
  return 'unknown';
}

/**
 * POST /assessments/provider-assignments — every listed instrument of the vacancy, one request (all or none are
 * reserved; the reason is the vacancy's). A 502 means some provider creates are still pending: the body is returned
 * with `complete: false` and re-sending the same request is safe.
 */
export function useAssignProviderAssessments(options?: { onSettled?: () => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: AssignProviderInput): Promise<AssignResponse> => {
      if (!isProviderAssessmentsStaffEnabled()) throw new Error('Provider assessments are not enabled');
      const body = {
        candidateId: input.candidateId,
        vacancyId: input.vacancyId,
        instruments: input.instruments.map((instrument) => ({ instrument })),
        ageBand: input.ageBand,
        timeMultiplier: input.timeMultiplier,
        aids: input.aids,
      };
      try {
        return assignResponseSchema.parse(await platformPost('/assessments/provider-assignments', body));
      } catch (error) {
        if (error instanceof PlatformApiError && error.status === 502) {
          const partial = assignResponseSchema.safeParse(error.body);
          if (partial.success) return partial.data;
        }
        throw error;
      }
    },
    onSettled: async (_data, _error, input) => {
      await queryClient.invalidateQueries({ queryKey: providerAttemptsKey(input.candidateId) });
      options?.onSettled?.();
    },
  });
}

/** POST /assessments/provider-assignments/{id}/cancel — before the sitting finished (e.g. to correct an accommodation). */
export function useCancelProviderAttempt(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (attemptId: string) => {
      if (!isProviderAssessmentsStaffEnabled()) throw new Error('Provider assessments are not enabled');
      return platformPost('/assessments/provider-assignments/{attemptId}/cancel', undefined, { attemptId });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: providerAttemptsKey(candidateId) }),
  });
}
