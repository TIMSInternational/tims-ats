import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { bedrockGenerate, calculateCost, type ModelId } from './client';
import { checkBudget } from './budget';
import { getCached, setCached } from './cache';
import { logInvocation } from './logger';
import { resolveAgentId, AGENT_REGISTRY } from './registry';

// ---------------------------------------------------------------------------
// invokeAgent — THE single gated door for every AI call.
//
// Pipeline (coding rule #2): budget → cache → PII → bedrock → validate → log.
//   1. budget   — fail CLOSED: over-budget (or disabled) org is denied.
//   2. cache    — org-scoped, TTL owned per agent; hit short-circuits Bedrock.
//   3. PII      — agents sanitize/wrap inputs (pii.ts) when building the message;
//                 bedrockGenerate additionally attaches the Bedrock Guardrail.
//   4. bedrock  — raw call via the circuit breaker (client.ts).
//   5. validate — Zod-parse the JSON output; malformed → per-agent fallback.
//   6. log      — every call (real or cached) is metered, then successful
//                 results are written to the cache.
//
// Budget/circuit failures THROW (fail-closed). A malformed AI response is NOT a
// system failure — it returns the agent's obviously-degraded fallback (rule #4),
// never fabricated data.
// ---------------------------------------------------------------------------

// Defensive upper bound on the fully-built message. Agents already bound their
// own fields via pii.sanitizeInput; this only catches pathological sizes and
// must stay well above any legitimate wrapped prompt so it never truncates one.
const HARD_MESSAGE_CAP = 32_000;

export interface InvokeAgentParams<TInput, TOutput> {
  /** Registry slug — selects model + cache TTL and resolves the FK agent id. */
  slug: string;
  orgId: string;
  /** Structured inputs — used verbatim for the org-scoped cache key. */
  input: TInput;
  systemPrompt: string;
  /** Build the user message; should sanitize/wrap free text via pii.ts. */
  buildUserMessage: (input: TInput) => string;
  /** Zod schema the model output must satisfy. */
  schema: z.ZodType<TOutput>;
  /** Obviously-degraded result when the model output can't be validated. */
  fallback: (rawText: string) => TOutput;
  maxTokens?: number;
  userId?: string;
}

export interface InvokeAgentResult<TOutput> {
  data: TOutput;
  model: string;
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
}

export async function invokeAgent<TInput, TOutput>(
  params: InvokeAgentParams<TInput, TOutput>,
): Promise<InvokeAgentResult<TOutput>> {
  const { slug, orgId, input, systemPrompt, buildUserMessage, schema, fallback, userId } = params;

  const def = AGENT_REGISTRY[slug];
  const model: ModelId = def?.model ?? 'haiku';
  // The registry value mirrors AiAgent.cacheTtlSeconds (it seeds the row); using
  // it here avoids an extra query while honoring the per-agent TTL.
  const ttl = def?.cacheTtlSeconds ?? 0;
  const maxTokens = params.maxTokens ?? 2048;

  const agentId = await resolveAgentId(slug);

  // 1. Budget — fail closed.
  const budget = await checkBudget(orgId, agentId);
  if (!budget.allowed) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'AI budget exceeded for this month' });
  }

  // 2. Cache — org-scoped, TTL owned by the agent (0 ⇒ bypass).
  const cached = await getCached<TOutput>(slug, orgId, input, ttl);
  if (cached !== null) {
    await logInvocation({
      agentId,
      organizationId: orgId,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      model,
      success: true,
      cached: true,
      userId,
    });
    return { data: cached, model, cached: true, inputTokens: 0, outputTokens: 0 };
  }

  // 3. PII — message is built (and sanitized/wrapped) by the agent; a final
  //    defensive sanitize is applied indirectly via the bound fields. Bound the
  //    overall size as a last resort.
  let userMessage = buildUserMessage(input);
  if (userMessage.length > HARD_MESSAGE_CAP) userMessage = userMessage.slice(0, HARD_MESSAGE_CAP);

  // 4. Bedrock — raw call via the circuit breaker.
  const result = await bedrockGenerate(model, systemPrompt, userMessage, maxTokens);
  const cost = calculateCost(model, result.inputTokens, result.outputTokens);

  // 5. Validate — extract + Zod-parse; malformed ⇒ fallback (fail-soft).
  let data: TOutput;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    data = jsonMatch ? schema.parse(JSON.parse(jsonMatch[0])) : fallback(result.text);
  } catch {
    data = fallback(result.text);
  }

  // 6. Log every real call (we paid for it regardless of parse outcome).
  await logInvocation({
    agentId,
    organizationId: orgId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: cost,
    latencyMs: result.latencyMs,
    model: result.model,
    success: true,
    cached: false,
    userId,
  });

  // Cache only validated results (setCached no-ops when ttl ⇐ 0).
  await setCached(slug, orgId, input, data, ttl);

  return {
    data,
    model: result.model,
    cached: false,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
