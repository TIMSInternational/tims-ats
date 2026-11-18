'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PlatformApiError, platformGet, platformPost, platformPostRaw } from './client';
import {
  isProviderAssessmentsStaffEnabled,
  PROVIDER_INSTRUMENTS,
  type ProviderInstrument,
} from './assessment-providers-staff';

// Round 12 — the platform owner's TIMS Assessments tools (the runbook found none): an organization's binding (bind,
// state, safe unbind) and the provider DSAR export and erasure for one candidate. C# only (PlatformOwnerGate on every
// route, each write audited there); dark with the rest of the provider connector.

export const BINDING_LOCALES = ['es', 'en'] as const;

const openWorkSchema = z
  .object({
    cancellable: z.number().int().min(0),
    awaitingResult: z.number().int().min(0),
    pendingWithdrawals: z.number().int().min(0),
    cancelPending: z.number().int().min(0),
    createsInFlight: z.number().int().min(0),
  })
  .strict();

export type ProviderOpenWork = z.infer<typeof openWorkSchema>;

const bindingStateSchema = z
  .object({
    bound: z.boolean(),
    active: z.boolean(),
    providerTenantId: z.string().uuid().nullable(),
    enabledInstruments: z.array(z.enum(PROVIDER_INSTRUMENTS)).max(PROVIDER_INSTRUMENTS.length),
    defaultLocale: z.string().max(5).nullable(),
    updatedAt: z.string().max(40).datetime({ offset: true }).nullable(),
    openWork: openWorkSchema,
  })
  .strict();

export type ProviderBindingState = z.infer<typeof bindingStateSchema>;

/** Whether any work would be stranded by an unbind. */
export function hasOpenWork(work: ProviderOpenWork): boolean {
  return Object.values(work).some((count) => count > 0);
}

export const bindingStateKey = (organizationId: string) => ['platform', 'provider-binding', organizationId] as const;

/** GET .../organizations/{id}/binding — the binding (in force or not) and the open work an unbind would strand. */
export function useProviderBindingState(organizationId: string) {
  return useQuery({
    queryKey: bindingStateKey(organizationId),
    enabled: isProviderAssessmentsStaffEnabled(),
    retry: false,
    queryFn: async (): Promise<ProviderBindingState> =>
      bindingStateSchema.parse(
        await platformGet('/platform/assessment-providers/organizations/{organizationId}/binding', undefined, {
          organizationId,
        }),
      ),
  });
}

export interface BindInput {
  instruments: ProviderInstrument[];
  defaultLocale: (typeof BINDING_LOCALES)[number];
}

/** POST /platform/assessment-providers/bindings — binds the org (or updates its instruments and locale). */
export function useBindOrganization(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: BindInput) =>
      platformPost('/platform/assessment-providers/bindings', {
        organizationId,
        instruments: input.instruments,
        defaultLocale: input.defaultLocale,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: bindingStateKey(organizationId) }),
  });
}

const unbindSchema = z
  .object({
    unbound: z.boolean(),
    openWork: openWorkSchema,
    cancelled: z.number().int().min(0),
    cancelFailed: z.number().int().min(0),
  })
  .strict();

const blockedSchema = z
  .object({
    error: z.literal('binding_has_open_work'),
    openWork: openWorkSchema,
    cancelled: z.number().int().min(0),
    cancelFailed: z.number().int().min(0),
  })
  .strict();

export type UnbindAnswer =
  | { kind: 'unbound'; cancelled: number }
  | { kind: 'blocked'; openWork: ProviderOpenWork; cancelled: number; cancelFailed: number };

/**
 * POST .../organizations/{id}/binding/unbind — refused while open work remains; with `cancelOpenAttempts` (the confirmed
 * choice) the unfinished sittings are cancelled at the provider first. A 409 comes back as `blocked` with what is left.
 */
export function useUnbindOrganization(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (cancelOpenAttempts: boolean): Promise<UnbindAnswer> => {
      try {
        const body = unbindSchema.parse(
          await platformPost(
            '/platform/assessment-providers/organizations/{organizationId}/binding/unbind',
            { cancelOpenAttempts },
            { organizationId },
          ),
        );
        return { kind: 'unbound', cancelled: body.cancelled };
      } catch (error) {
        if (error instanceof PlatformApiError && error.status === 409) {
          const blocked = blockedSchema.safeParse(error.body);
          if (blocked.success) return { kind: 'blocked', ...blocked.data };
        }
        throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: bindingStateKey(organizationId) }),
  });
}

/** The stable reason a call failed: the route's `{ error }`, else the HTTP status. */
export function adminErrorCode(error: unknown): string {
  if (error instanceof PlatformApiError) {
    const body = error.body;
    if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
      return (body as { error: string }).error.slice(0, 64);
    }
    return `http_${error.status}`;
  }
  return 'unknown';
}

const candidatePath = '/platform/assessment-providers/organizations/{organizationId}/candidates/{candidateId}' as const;

/**
 * GET .../candidates/{id}/export — the DSAR access export (the ATS's provider tables and the provider's own export of
 * each subject), audited by C#. Returned as the exact JSON text to download; never logged or cached.
 */
export async function exportCandidate(organizationId: string, candidateId: string): Promise<string> {
  const body = await platformGet(`${candidatePath}/export`, undefined, { organizationId, candidateId });
  return JSON.stringify(body, null, 2);
}

const erasureSchema = z.object({ subjects: z.number().int().min(0), requested: z.number().int().min(0) }).strict();

export type ErasureAnswer = { complete: boolean; subjects: number; requested: number };

/** POST .../candidates/{id}/erasure — 202 when every subject's erasure was accepted; a 503 with counts is incomplete. */
export async function eraseCandidate(organizationId: string, candidateId: string): Promise<ErasureAnswer> {
  try {
    const body = erasureSchema.parse(
      await platformPostRaw(`${candidatePath}/erasure`, undefined, { organizationId, candidateId }),
    );
    return { complete: true, ...body };
  } catch (error) {
    if (error instanceof PlatformApiError && error.status === 503) {
      const partial = erasureSchema.safeParse(error.body);
      if (partial.success) return { complete: false, ...partial.data };
    }
    throw error;
  }
}

/** Saves `text` as a JSON file in the browser (the platform owner delivers it to the data subject). */
export function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
