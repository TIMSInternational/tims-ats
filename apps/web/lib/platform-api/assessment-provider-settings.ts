'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { platformGet, platformSendRaw } from './client';
import { isProviderAssessmentsStaffEnabled } from './assessment-providers-staff';

// The org's assessment security settings (proctoring parity with timssuite.com, owner decision 2026-11-11). C# only:
// GET/PUT /assessments/provider-settings/proctoring (assessment:read / assessment:update, organization scope). Every
// TIMS assignment created after a change carries them; a PCA never does.

export const ANTI_CHEAT_CONSEQUENCES = ['warn', 'auto_submit', 'void'] as const;
export type AntiCheatConsequence = (typeof ANTI_CHEAT_CONSEQUENCES)[number];

export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 20;

const antiCheatSchema = z
  .object({
    threshold: z.number().int().min(MIN_THRESHOLD).max(MAX_THRESHOLD),
    consequence: z.enum(ANTI_CHEAT_CONSEQUENCES),
  })
  .strict();

const settingsSchema = z
  .object({
    lockdown: z.boolean(),
    antiCheat: antiCheatSchema.nullable(),
    identityCheck: z.boolean(),
    /** False while no approved biometric consent text describes the face checks: the switch is shown disabled. */
    identityCheckAvailable: z.boolean(),
    updatedAt: z.string().max(40).datetime({ offset: true }).nullable(),
  })
  .strict();

export type ProctoringSettings = z.infer<typeof settingsSchema>;
export type ProctoringSettingsInput = Pick<ProctoringSettings, 'lockdown' | 'antiCheat' | 'identityCheck'>;

const PATH = '/assessments/provider-settings/proctoring';
export const proctoringSettingsKey = ['platform', 'provider-settings', 'proctoring'] as const;

export function useProctoringSettings() {
  return useQuery({
    queryKey: proctoringSettingsKey,
    enabled: isProviderAssessmentsStaffEnabled(),
    retry: false,
    queryFn: async (): Promise<ProctoringSettings> => settingsSchema.parse(await platformGet(PATH)),
  });
}

/** PUT — the whole block every time (strict on the C# side). Answers the stored settings. */
export function useSaveProctoringSettings(options?: { onSuccess?: () => void; onError?: (error: unknown) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: ProctoringSettingsInput): Promise<ProctoringSettings> => {
      if (!isProviderAssessmentsStaffEnabled()) throw new Error('Provider assessments are not enabled');
      const body = { lockdown: input.lockdown, antiCheat: input.antiCheat, identityCheck: input.identityCheck };
      return settingsSchema.parse(await platformSendRaw('PUT', PATH, body));
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(proctoringSettingsKey, saved);
      options?.onSuccess?.();
    },
    onError: (error) => options?.onError?.(error),
  });
}
