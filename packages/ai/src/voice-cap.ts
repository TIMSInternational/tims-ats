import { TRPCError } from '@trpc/server';
import { tenantDb, runWithTenant } from '@tims/db';
import { logger } from '@tims/shared';

// ---------------------------------------------------------------------------
// AI voice interview — monthly spend cap per organization.
//
// The voice session itself runs on ElevenLabs, not through invokeAgent, so the
// per-agent budget check in invokeAgent never sees it. Its cost is recorded in
// ai_agent_usage_logs under the 'ai-voice-interview' agent after each call.
// This module answers "may this organization start ANOTHER voice session this
// month?" from that ledger:
//
//   cap   = aiAgentOrgConfig.monthlyBudget for the voice agent, else 25 USD
//   spent = this calendar month's ai_agent_usage_logs.cost_usd for the voice agent
//   over  = spent >= cap
//
// Enforcement is OPT-IN: only AI_VOICE_HARD_CAP_ENABLED='true' turns an over-cap
// result into a refusal (TRPCError TOO_MANY_REQUESTS `ai_voice_cap_reached`).
// Unset/anything else keeps today's meter-and-bill behaviour: the session
// proceeds and an over-cap warning is logged. Read per call.
//
// Intended caller: the voice-session start procedure, before it requests the
// ElevenLabs signed URL (a refusal there leaves the session pending, so the
// candidate can start it later in a new month or after the cap is raised).
// ---------------------------------------------------------------------------

export const AI_VOICE_INTERVIEW_AGENT_SLUG = 'ai-voice-interview';

/** Cap used when the organization has no configured monthlyBudget for the voice agent. */
export const VOICE_CAP_DEFAULT_MONTHLY_USD = 25;

/** Opt-in switch: only the exact string 'true' enforces the cap. */
export const AI_VOICE_HARD_CAP_ENV = 'AI_VOICE_HARD_CAP_ENABLED';

/** Stable machine code carried as the TRPCError message when a session is refused. */
export const AI_VOICE_CAP_REACHED = 'ai_voice_cap_reached';

export interface VoiceCapStatus {
  capUsd: number;
  spentUsd: number;
  overCap: boolean;
  /** Whether an over-cap result refuses the session (AI_VOICE_HARD_CAP_ENABLED='true'). */
  enforced: boolean;
}

export function isVoiceHardCapEnabled(value: string | undefined = process.env[AI_VOICE_HARD_CAP_ENV]): boolean {
  return value === 'true';
}

/** Pure decision. A negative or non-finite configured budget is treated as unset. */
export function evaluateVoiceCap(
  spentUsd: number,
  monthlyBudgetUsd: number | null | undefined,
  enforced: boolean,
): VoiceCapStatus {
  const capUsd =
    typeof monthlyBudgetUsd === 'number' && Number.isFinite(monthlyBudgetUsd) && monthlyBudgetUsd >= 0
      ? monthlyBudgetUsd
      : VOICE_CAP_DEFAULT_MONTHLY_USD;
  return { capUsd, spentUsd, overCap: spentUsd >= capUsd, enforced };
}

/** Read the organization's voice cap and this month's voice spend (tenant-scoped reads). */
export async function checkVoiceSessionCap(orgId: string, now: Date = new Date()): Promise<VoiceCapStatus> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { config, usage } = await runWithTenant(orgId, async () => ({
    config: await tenantDb.aiAgentOrgConfig.findFirst({
      where: { organizationId: orgId, agent: { slug: AI_VOICE_INTERVIEW_AGENT_SLUG } },
      select: { monthlyBudget: true },
    }),
    usage: await tenantDb.aiAgentUsageLog.aggregate({
      where: { organizationId: orgId, agent: { slug: AI_VOICE_INTERVIEW_AGENT_SLUG }, createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
    }),
  }));
  return evaluateVoiceCap(usage._sum.costUsd ?? 0, config?.monthlyBudget, isVoiceHardCapEnabled());
}

/**
 * Gate for starting a NEW voice session. Over the cap: always logs a structured warning; throws
 * only when enforcement is on. Returns the status so the caller can surface or meter it.
 */
export async function assertVoiceSessionWithinCap(orgId: string, now: Date = new Date()): Promise<VoiceCapStatus> {
  const status = await checkVoiceSessionCap(orgId, now);
  if (!status.overCap) return status;
  logger.warn(
    {
      organizationId: orgId,
      module: 'ai_voice_interview',
      monthlyCapUsd: status.capUsd,
      monthToDateSpendUsd: status.spentUsd,
      enforced: status.enforced,
    },
    status.enforced
      ? 'ai-interview: monthly voice cap reached — new session refused'
      : 'ai-interview: monthly voice spend over soft cap — session proceeds (enforcement off)',
  );
  if (status.enforced) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: AI_VOICE_CAP_REACHED });
  return status;
}
