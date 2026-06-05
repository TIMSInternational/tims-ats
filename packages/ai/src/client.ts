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

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION ?? 'us-east-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const MODELS = {
  haiku: bedrock('anthropic.claude-3-5-haiku-20241022-v1:0'),
  sonnet: bedrock('anthropic.claude-sonnet-4-20250514-v1:0'),
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
