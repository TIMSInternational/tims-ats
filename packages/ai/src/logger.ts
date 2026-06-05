import { db } from '@tims/db';

// ---------------------------------------------------------------------------
// Usage logger — records every AI invocation (real OR cache hit) for cost
// metering and audit. A cache hit is logged with cached:true and zero tokens/
// cost so per-org spend reflects only real Bedrock calls while still capturing
// usage volume. PII-free by construction: only ids, counts, and cost.
// ---------------------------------------------------------------------------

export async function logInvocation(params: {
  agentId: string;
  organizationId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  model: string;
  success: boolean;
  cached?: boolean;
  userId?: string;
}): Promise<void> {
  await db.aiAgentUsageLog.create({
    data: {
      agentId: params.agentId,
      organizationId: params.organizationId,
      userId: params.userId ?? null,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: params.costUsd,
      latencyMs: params.latencyMs,
      cached: params.cached ?? false,
    },
  }).catch(() => {
    // Non-critical — don't fail the request if logging fails
  });
}
