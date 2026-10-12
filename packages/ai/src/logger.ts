import { db } from '@tims/db';
import { logger } from '@tims/shared';

// ---------------------------------------------------------------------------
// Usage logger — records every AI invocation (real OR cache hit) for cost
// metering and audit. A cache hit is logged with cached:true and zero tokens/
// cost so per-org spend reflects only real Bedrock calls while still capturing
// usage volume. PII-free by construction: only ids, counts, and cost.
//
// These rows ARE the budget ledger (budget.ts sums costUsd from them), so a
// dropped write is a fail-open budget, not a cosmetic loss:
//   - A missing `success` column (P2022: code deployed before its DDL) retries
//     the insert without `success`, so cost rows keep landing with success=NULL.
//   - Every other failure is still swallowed (never fail the AI request), but
//     is logged with the error code — never the error message, which may echo
//     row values.
// ---------------------------------------------------------------------------

function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

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
  const base = {
    agentId: params.agentId,
    organizationId: params.organizationId,
    userId: params.userId ?? null,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    costUsd: params.costUsd,
    latencyMs: params.latencyMs,
    cached: params.cached ?? false,
  };
  const warn = (err: unknown, stage: string): void => {
    logger.warn(
      { agentId: params.agentId, organizationId: params.organizationId, code: prismaErrorCode(err) ?? 'unknown', stage },
      'ai usage log write failed — AI cost metering row dropped',
    );
  };

  try {
    // Explicit select: Prisma otherwise RETURNs every mapped column.
    await db.aiAgentUsageLog.create({ data: { ...base, success: params.success }, select: { id: true } });
  } catch (err) {
    if (prismaErrorCode(err) !== 'P2022') {
      warn(err, 'insert');
      return;
    }
    warn(err, 'success-column-missing');
    try {
      await db.aiAgentUsageLog.create({ data: base, select: { id: true } });
    } catch (retryErr) {
      warn(retryErr, 'retry-without-success');
    }
  }
}
