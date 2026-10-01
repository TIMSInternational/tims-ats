'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { CONSENT_WITHDRAWAL_CHANNELS, CONSENT_WITHDRAWAL_REASON_MAX } from '@tims/shared';
import { isPlatformApiEnabled, platformGet, platformPost, platformPostRaw, PlatformApiError } from './client';

// #312/#313 — candidate data-processing consent lives ONLY in C# (no tRPC twin), so the surface is dark unless BOTH
// the C# base URL and this opt-in flag are set. Enable it only after Platform__CandidateConsentEnabled is on.
const VIA_CSHARP = process.env.NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP === 'true';

export function isCandidateConsentEnabled(): boolean {
  return VIA_CSHARP && isPlatformApiEnabled();
}

const isoTimestamp = z.string().max(40).datetime();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const consentStatusSchema = z
  .object({
    status: z.enum(['granted', 'withdrawn', 'none']),
    textVersion: z.string().max(64).nullable(),
    agreedAt: isoTimestamp.nullable(),
    withdrawnAt: isoTimestamp.nullable(),
    withdrawalChannel: z.string().max(30).nullable(),
    withdrawalReason: z.string().max(CONSENT_WITHDRAWAL_REASON_MAX).nullable(),
    withdrawnBy: z.enum(['staff', 'candidate']).nullable(),
  })
  .strict();

const evidenceSchema = z
  .object({
    applicationId: z.string().uuid(),
    textVersion: z.string().max(64),
    textSha256: sha256.nullable(),
    locale: z.string().max(5).nullable(),
    agreedAt: isoTimestamp,
    captchaVerified: z.boolean().nullable(),
    hasRequestMetadata: z.boolean(),
    isBackfilled: z.boolean(),
  })
  .strict();

const deletionRequestSchema = z
  .object({
    id: z.string().uuid(),
    status: z.string().max(20),
    source: z.string().max(30),
    createdAt: isoTimestamp,
  })
  .strict();

export const candidateConsentViewSchema = z
  .object({
    candidateId: z.string().uuid(),
    consent: consentStatusSchema,
    evidence: z.array(evidenceSchema).max(100),
    deletionRequest: deletionRequestSchema.nullable(),
  })
  .strict();

export type CandidateConsentView = z.infer<typeof candidateConsentViewSchema>;

export const staffWithdrawalSchema = z
  .object({
    channel: z.enum(CONSENT_WITHDRAWAL_CHANNELS),
    reason: z.string().trim().max(CONSENT_WITHDRAWAL_REASON_MAX).optional(),
    requestDeletion: z.boolean(),
  })
  .strict();

export type StaffWithdrawalInput = z.input<typeof staffWithdrawalSchema>;

const candidateConsentKey = (candidateId: string) => ['platform', 'candidate-consent', candidateId] as const;

/** GET /tenant/candidates/{id}/consent (candidate:read, org scope). Disabled unless the flag is on. */
export function useCandidateConsent(candidateId: string) {
  return useQuery({
    queryKey: candidateConsentKey(candidateId),
    enabled: isCandidateConsentEnabled(),
    retry: false,
    queryFn: async (): Promise<CandidateConsentView> =>
      candidateConsentViewSchema.parse(
        await platformGet('/tenant/candidates/{candidateId}/consent', undefined, { candidateId }),
      ),
  });
}

/** POST /tenant/candidates/{id}/consent/withdrawal. Never retried; refreshes the card on success. */
export function useWithdrawCandidateConsent(
  candidateId: string,
  options?: { onSuccess?: () => void; onError?: (error: Error) => void },
) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: StaffWithdrawalInput): Promise<CandidateConsentView> => {
      if (!isCandidateConsentEnabled()) throw new Error('Candidate consent is not enabled');
      const parsed = staffWithdrawalSchema.parse(input);
      const body = { ...parsed, reason: parsed.reason ? parsed.reason : undefined };
      return candidateConsentViewSchema.parse(
        await platformPost('/tenant/candidates/{candidateId}/consent/withdrawal', body, { candidateId }),
      );
    },
    onSuccess: (view) => {
      queryClient.setQueryData(candidateConsentKey(candidateId), view);
      options?.onSuccess?.();
    },
    onError: (error: Error) => options?.onError?.(error),
  });
}

const portalAckSchema = z.object({ received: z.literal(true) }).strict();

/**
 * POST /portal/consent/withdrawal — the signed-in candidate revokes their own authorization at this organization.
 * The identity is the session's verified email, never input. Resolves on the uniform acknowledgement.
 */
export async function withdrawMyConsent(organizationSlug: string): Promise<void> {
  if (!isCandidateConsentEnabled()) throw new Error('Candidate consent is not enabled');
  portalAckSchema.parse(await platformPostRaw('/portal/consent/withdrawal', { organizationSlug }));
}

export type ConsentErrorKind = 'forbidden' | 'not_verified' | 'not_found' | 'rate_limited' | 'other';

/** Stable classification of a failed consent call, so the UI maps it to a translated message. */
export function classifyConsentError(error: unknown): ConsentErrorKind {
  if (error instanceof PlatformApiError) {
    if (error.status === 403) return error.code === 'email_not_verified' ? 'not_verified' : 'forbidden';
    if (error.status === 404) return 'not_found';
    if (error.status === 429) return 'rate_limited';
  }
  return 'other';
}
