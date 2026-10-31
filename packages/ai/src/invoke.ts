import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { logger } from '@tims/shared';
import { bedrockGenerate, calculateCost, BedrockTimeoutError, type ModelId, type InvokeResult } from './client';
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
// Budget/circuit/timeout failures THROW (fail-closed). A malformed AI response
// is NOT a system failure — it returns the agent's
// obviously-degraded fallback (rule #4), never fabricated data. A fallback is
// flagged `validated: false`, never cached, and reported via logger.warn. It is
// also passed to logInvocation as success:false, stored in ai_agent_usage_logs.success (#356;
// logger.ts retries without the column only on P2022, i.e. code deployed before its DDL).
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
  /** False when Bedrock returned malformed output and the agent fallback was used. */
  validated: boolean;
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
  //    A hit is re-validated against the agent's current schema; an entry that
  //    no longer satisfies it (e.g. written before an output bound existed) is
  //    treated as a miss rather than served.
  const cachedRaw = await getCached<unknown>(slug, orgId, input, ttl);
  const cachedParse = cachedRaw === null ? null : schema.safeParse(cachedRaw);
  if (cachedParse?.success) {
    const cached = cachedParse.data;
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
    return { data: cached, model, cached: true, validated: true, inputTokens: 0, outputTokens: 0 };
  }

  // 3. PII — message is built (and sanitized/wrapped) by the agent; a final
  //    defensive sanitize is applied indirectly via the bound fields. Bound the
  //    overall size as a last resort.
  let userMessage = buildUserMessage(input);
  if (userMessage.length > HARD_MESSAGE_CAP) userMessage = userMessage.slice(0, HARD_MESSAGE_CAP);

  // 4. Bedrock — raw call via the circuit breaker. A timeout is logged as a
  //    failed call and then rethrown, exactly like any other Bedrock error:
  //    callers that persist results must not store a fallback as if it were a
  //    real answer.
  const started = Date.now();
  let result: InvokeResult;
  try {
    result = await bedrockGenerate(model, systemPrompt, userMessage, maxTokens);
  } catch (error) {
    if (!(error instanceof BedrockTimeoutError)) throw error;
    logger.warn({ agent: slug, reason: 'timeout' }, 'AI agent call timed out');
    await logInvocation({
      agentId,
      organizationId: orgId,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - started,
      model,
      success: false,
      cached: false,
      userId,
    });
    throw error;
  }
  const cost = calculateCost(model, result.inputTokens, result.outputTokens);

  // 5. Validate — extract + Zod-parse; malformed ⇒ fallback (fail-soft).
  let data: TOutput;
  let validated = false;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      data = schema.parse(JSON.parse(jsonMatch[0]));
      validated = true;
    } else {
      data = fallback(result.text);
    }
  } catch {
    data = fallback(result.text);
  }
  if (!validated) logger.warn({ agent: slug, reason: 'invalid_output' }, 'AI agent degraded to fallback');

  // 6. Log every real call (we paid for it regardless of parse outcome).
  await logInvocation({
    agentId,
    organizationId: orgId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: cost,
    latencyMs: result.latencyMs,
    model: result.model,
    success: validated,
    cached: false,
    userId,
  });

  // A malformed response must not poison the cache (even for non-PII agents).
  if (validated) await setCached(slug, orgId, input, data, ttl);

  return {
    data,
    model: result.model,
    cached: false,
    validated,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
