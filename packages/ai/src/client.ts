import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Bedrock Client — wraps AI SDK with circuit breaker pattern
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

type ModelId = keyof typeof MODELS;

// Simple circuit breaker state
let failures = 0;
let circuitOpenUntil = 0;
const MAX_FAILURES = 5;
const COOLDOWN_MS = 30_000;

export interface InvokeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  latencyMs: number;
}

export async function invokeAgent(
  model: ModelId,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 2048,
): Promise<InvokeResult> {
  // Circuit breaker check
  if (failures >= MAX_FAILURES && Date.now() < circuitOpenUntil) {
    throw new Error('AI service temporarily unavailable (circuit open)');
  }

  const start = Date.now();

  try {
    const result = await generateText({
      model: MODELS[model],
      system: systemPrompt,
      prompt: userMessage,
      maxTokens,
    });

    // Reset circuit on success
    failures = 0;

    return {
      text: result.text,
      inputTokens: result.usage?.promptTokens ?? 0,
      outputTokens: result.usage?.completionTokens ?? 0,
      model,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    failures++;
    if (failures >= MAX_FAILURES) {
      circuitOpenUntil = Date.now() + COOLDOWN_MS;
    }
    throw error;
  }
}

// Cost calculation per model
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
