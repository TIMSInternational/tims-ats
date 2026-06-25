import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';
import { bedrockCircuit } from './circuit';
import { bedrockGuardrailOptions } from './pii';

// ---------------------------------------------------------------------------
// Bedrock client — the ONLY place that calls AWS Bedrock.
//
// `bedrockGenerate` is the raw model call. It is intentionally NOT the gated
// entry point: every agent goes through the gated `invokeAgent` in invoke.ts
// (budget → cache → PII → bedrockGenerate → validate → log). Routers/services
// must never import this directly — a CI grep-gate enforces that (rule #2).
//
// The call is wrapped in `bedrockCircuit` (5 failures → open 30s) and, when a
// Bedrock Guardrail is provisioned, references it so PII is masked server-side.
// ---------------------------------------------------------------------------

// Bedrock may run in a DIFFERENT AWS account than the rest of the app (SES etc.):
// the primary account's Bedrock daily-token quota is a hard non-adjustable cap, so
// Bedrock is pointed at an account with real quota via BEDROCK_AWS_* env vars.
// Falls back to the shared AWS_* credentials when the dedicated ones are unset, so
// nothing breaks if both services live in the same account.
const bedrock = createAmazonBedrock({
  region: process.env.BEDROCK_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-2',
  accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
});

// Current-generation Claude models, invoked through US cross-region inference
// profiles (the `us.` prefix is required — bare ids return "on-demand throughput
// isn't supported"). The previous ids were stale: Claude 3.5 Haiku reached EOL and
// Sonnet 4's per-day on-demand quota is a hard, non-adjustable cap. Haiku 4.5 and
// Sonnet 4.5 are the current actively-supported equivalents (verified ACTIVE +
// invokable in-account). Region is a US one (us-east-2 default).
const MODELS = {
  haiku: bedrock('us.anthropic.claude-haiku-4-5-20251001-v1:0'),
  sonnet: bedrock('us.anthropic.claude-sonnet-4-5-20250929-v1:0'),
} as const;

export type ModelId = keyof typeof MODELS;

export interface InvokeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  latencyMs: number;
}

/**
 * Raw Bedrock text generation, guarded by the circuit breaker and (when
 * provisioned) a Bedrock Guardrail. Internal — only invoke.ts should call it.
 */
export async function bedrockGenerate(
  model: ModelId,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 2048,
): Promise<InvokeResult> {
  const guardrail = bedrockGuardrailOptions();
  const start = Date.now();

  return bedrockCircuit.execute(async () => {
    const result = await generateText({
      model: MODELS[model],
      system: systemPrompt,
      prompt: userMessage,
      maxTokens,
      ...(guardrail ? { providerOptions: guardrail } : {}),
    });

    return {
      text: result.text,
      inputTokens: result.usage?.promptTokens ?? 0,
      outputTokens: result.usage?.completionTokens ?? 0,
      model,
      latencyMs: Date.now() - start,
    };
  });
}

// Cost calculation per model (USD per 1K tokens).
const COST_PER_1K_INPUT: Record<ModelId, number> = {
  haiku: 0.001,
  sonnet: 0.003,
};
const COST_PER_1K_OUTPUT: Record<ModelId, number> = {
  haiku: 0.005,
  sonnet: 0.015,
};

export function calculateCost(model: ModelId, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000) * COST_PER_1K_INPUT[model] + (outputTokens / 1000) * COST_PER_1K_OUTPUT[model];
}
