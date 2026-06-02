import { db } from '@tims/db';

// ---------------------------------------------------------------------------
// Usage logger — tracks every AI invocation for cost and audit
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
}): Promise<void> {
  await db.aiAgentUsageLog.create({
    data: {
      agentId: params.agentId,
      organizationId: params.organizationId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: params.costUsd,
      latencyMs: params.latencyMs,
      cached: false,
    },
  }).catch(() => {
    // Non-critical — don't fail the request if logging fails
  });
}
