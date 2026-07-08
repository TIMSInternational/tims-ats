// packages/api/src/services/ai-interview-access.service.ts
// Access + cap resolution for the AI Voice Interview paid add-on.
// Pure helpers here are unit-tested; impure db loaders (added in Task 3) are
// covered by static-source tripwires.

import { db as systemDb } from '@tims/db';
import { hasEntitlement, requireEntitlement } from './entitlement.service';

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

/**
 * True iff the feature is enabled for the org — this is the UI-facing visibility
 * signal (drives `aiScreenEnabled` in the recruiter Interviews table, which shows
 * either the "Start AI Screen" action or the disabled/upsell state). Must agree
 * with `assertAiInterviewEnabled` (the hard runtime gate): the `ai_voice_interview`
 * `OrgEntitlement` module is the SINGLE enablement switch (toggled by the platform
 * owner). `aiAgentOrgConfig` (and its `enabled` field / `isEnabledConfig`) supplies
 * BILLING params only (budget, per-minute price, minute caps) — it does not gate
 * visibility. Gating on config too previously caused a divergence: an entitled org
 * with `aiAgentOrgConfig.enabled = false`, or with no config row at all (e.g. org
 * "INVU"), had the UI button hidden while the server-side mutation still allowed
 * it. Entitlement-only keeps both gates in agreement.
 */
export async function isAiInterviewEnabled(organizationId: string): Promise<boolean> {
  return hasEntitlement(organizationId, 'ai_voice_interview');
}

/**
 * Fail-closed gate. Enablement is decided by the `ai_voice_interview` entitlement
 * (contract-driven) — `requireEntitlement` throws FORBIDDEN when the org's company
 * lacks the module. `aiAgentOrgConfig` no longer gates access; it only supplies
 * billing params (budget, per-minute price, minute caps) once the gate passes.
 */
export async function assertAiInterviewEnabled(
  organizationId: string,
): Promise<AiInterviewConfig> {
  // Gate: the company must have the ai_voice_interview module entitled (contract-driven).
  await requireEntitlement(organizationId, 'ai_voice_interview');
  // Billing params still come from aiAgentOrgConfig (budget, per-minute price, minute caps).
  const config = await loadAiInterviewConfig(organizationId);
  return (
    config ?? {
      // Non-gating / billing-era vestigial: kept only to satisfy the required
      // `enabled` field on AiInterviewConfig. Enablement is decided solely by the
      // entitlement above; no consumer reads `.enabled` off this return.
      enabled: true,
      monthlyBudget: null,
      billableUsdPerMinute: null,
      addonMonthlyFeeUsd: null,
      aiInterviewDefaultMaxMinutes: null,
      aiInterviewMaxMinutesByType: null,
    }
  );
}
