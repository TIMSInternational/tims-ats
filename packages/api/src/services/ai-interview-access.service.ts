// packages/api/src/services/ai-interview-access.service.ts
// Access + cap resolution for the AI Voice Interview paid add-on.
// Pure helpers here are unit-tested; impure db loaders (added in Task 3) are
// covered by static-source tripwires.

import { db as systemDb } from '@tims/db';
import { TRPCError } from '@trpc/server';

/** The single source of truth for the voice-interview agent slug. */
export const AI_VOICE_INTERVIEW_SLUG = 'ai-voice-interview';

/** Org-default duration cap (minutes) when nothing is configured. */
export const AI_INTERVIEW_DEFAULT_MAX_MINUTES = 15;

/** The subset of the ai-voice-interview AiAgentOrgConfig row this feature reads. */
export interface AiInterviewConfig {
  enabled: boolean;
  monthlyBudget: number | null;
  billableUsdPerMinute: number | null;
  addonMonthlyFeeUsd: number | null;
  aiInterviewDefaultMaxMinutes: number | null;
  aiInterviewMaxMinutesByType: unknown;
}

/** Feature is ON iff a config row exists with enabled === true. */
export function isEnabledConfig(config: AiInterviewConfig | null): boolean {
  return config?.enabled === true;
}

/** A positive integer minute count, or null. */
function positiveMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolve the per-interview duration cap in SECONDS:
 *   override[type] ?? orgDefault ?? 15 (minutes) * 60.
 * Malformed/zero/negative values are ignored (treated as unset).
 */
export function resolveMaxDurationSeconds(
  interviewType: string,
  config: AiInterviewConfig | null,
): number {
  let overrideMinutes: number | null = null;
  const map = config?.aiInterviewMaxMinutesByType;
  if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
    overrideMinutes = positiveMinutes((map as Record<string, unknown>)[interviewType]);
  }
  const defaultMinutes = positiveMinutes(config?.aiInterviewDefaultMaxMinutes);
  const minutes = overrideMinutes ?? defaultMinutes ?? AI_INTERVIEW_DEFAULT_MAX_MINUTES;
  return minutes * 60;
}

/**
 * Load the ai-voice-interview AiAgentOrgConfig for an org, or null.
 * Uses systemDb + explicit organizationId filter so it works in the
 * candidate (publicProcedure, no RLS GUC) path as well as recruiter paths.
 */
export async function loadAiInterviewConfig(
  organizationId: string,
): Promise<AiInterviewConfig | null> {
  const config = await systemDb.aiAgentOrgConfig.findFirst({
    where: { organizationId, agent: { slug: AI_VOICE_INTERVIEW_SLUG } },
    select: {
      enabled: true,
      monthlyBudget: true,
      billableUsdPerMinute: true,
      addonMonthlyFeeUsd: true,
      aiInterviewDefaultMaxMinutes: true,
      aiInterviewMaxMinutesByType: true,
    },
  });
  return config;
}

/** True iff the feature is enabled for the org. */
export async function isAiInterviewEnabled(organizationId: string): Promise<boolean> {
  return isEnabledConfig(await loadAiInterviewConfig(organizationId));
}

/**
 * Fail-closed gate. Throws FORBIDDEN when the feature is off for the org;
 * returns the config (so callers reuse billing/cap fields without a 2nd query).
 */
export async function assertAiInterviewEnabled(
  organizationId: string,
): Promise<AiInterviewConfig> {
  const config = await loadAiInterviewConfig(organizationId);
  if (!isEnabledConfig(config)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'AI Voice Interview is not enabled for this organization',
    });
  }
  // isEnabledConfig narrowed config to non-null.
  return config as AiInterviewConfig;
}
