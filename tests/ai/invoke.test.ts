import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock every dependency of the gated path so we test the orchestration logic
// (order, fail-closed, fail-soft, cache short-circuit) without Bedrock or a DB.
vi.mock('../../packages/ai/src/client', () => ({
  bedrockGenerate: vi.fn(),
  calculateCost: vi.fn(() => 0.01),
  BedrockTimeoutError: class BedrockTimeoutError extends Error {
    constructor(ms: number) {
      super(`timed out after ${ms}ms`);
      this.name = 'BedrockTimeoutError';
    }
  },
}));
vi.mock('@tims/shared', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../packages/ai/src/budget', () => ({ checkBudget: vi.fn() }));
vi.mock('../../packages/ai/src/cache', () => ({ getCached: vi.fn(), setCached: vi.fn() }));
vi.mock('../../packages/ai/src/logger', () => ({ logInvocation: vi.fn() }));
vi.mock('../../packages/ai/src/registry', () => ({
  resolveAgentId: vi.fn(async () => 'agent-uuid'),
  AGENT_REGISTRY: {
    'vacancy-writer': { slug: 'vacancy-writer', name: 'VW', model: 'sonnet', category: 'r', batchEligible: false, cacheTtlSeconds: 60 },
  },
}));

import { invokeAgent } from '../../packages/ai/src/invoke';
import { bedrockGenerate, BedrockTimeoutError } from '../../packages/ai/src/client';
import { logger } from '@tims/shared';
import { checkBudget } from '../../packages/ai/src/budget';
import { getCached, setCached } from '../../packages/ai/src/cache';
import { logInvocation } from '../../packages/ai/src/logger';

const schema = z.object({ description: z.string() });
const params = {
  slug: 'vacancy-writer',
  orgId: 'org-1',
  input: { title: 'x' },
  systemPrompt: 'sys',
  buildUserMessage: () => 'built message',
  schema,
  fallback: (raw: string) => ({ description: `fallback:${raw}` }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkBudget).mockResolvedValue({ allowed: true, spent: 0, budget: 25 });
  vi.mocked(getCached).mockResolvedValue(null);
});

describe('invokeAgent (gated path)', () => {
  it('fails CLOSED when over budget — never calls Bedrock', async () => {
    vi.mocked(checkBudget).mockResolvedValue({ allowed: false, spent: 99, budget: 25 });
    await expect(invokeAgent(params)).rejects.toThrow();
    expect(bedrockGenerate).not.toHaveBeenCalled();
  });

  it('returns a cache hit without calling Bedrock and logs it as cached', async () => {
    vi.mocked(getCached).mockResolvedValue({ description: 'cached' });
    const r = await invokeAgent(params);
    expect(r).toMatchObject({ cached: true, data: { description: 'cached' } });
    expect(bedrockGenerate).not.toHaveBeenCalled();
    expect(logInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ cached: true, costUsd: 0, inputTokens: 0 }),
    );
  });

  it('on a real call: validates output, caches it, and logs uncached', async () => {
    vi.mocked(bedrockGenerate).mockResolvedValue({
      text: 'noise {"description":"hi"} trailing', inputTokens: 10, outputTokens: 5, model: 'sonnet', latencyMs: 100,
    });
    const r = await invokeAgent(params);
    expect(r.data).toEqual({ description: 'hi' });
    expect(r.cached).toBe(false);
    expect(setCached).toHaveBeenCalledTimes(1);
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ cached: false }));
  });

  it('fails SOFT on unparseable output — returns the fallback, still logs the spend', async () => {
    vi.mocked(bedrockGenerate).mockResolvedValue({
      text: 'totally not json', inputTokens: 10, outputTokens: 5, model: 'sonnet', latencyMs: 1,
    });
    const r = await invokeAgent(params);
    expect(r.data).toEqual({ description: 'fallback:totally not json' });
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ cached: false }));
  });

  it('checks budget before the cache (budget is the outermost gate)', async () => {
    const order: string[] = [];
    vi.mocked(checkBudget).mockImplementation(async () => {
      order.push('budget');
      return { allowed: true, spent: 0, budget: 25 };
    });
    vi.mocked(getCached).mockImplementation(async () => {
      order.push('cache');
      return { description: 'cached' };
    });
    await invokeAgent(params);
    expect(order).toEqual(['budget', 'cache']);
  });

  it('logs a validated answer as success and returns degraded:false', async () => {
    vi.mocked(bedrockGenerate).mockResolvedValue({
      text: '{"description":"hi"}', inputTokens: 10, outputTokens: 5, model: 'haiku', latencyMs: 1,
    });
    const r = await invokeAgent(params);
    expect(r.degraded).toBe(false);
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it.each([
    ['unparseable text', 'totally not json'],
    ['JSON that fails the schema', '{"description": 42}'],
  ])('a fallback from %s is logged success:false, flagged degraded, and never cached', async (_label, text) => {
    vi.mocked(bedrockGenerate).mockResolvedValue({ text, inputTokens: 10, outputTokens: 5, model: 'haiku', latencyMs: 1 });
    const r = await invokeAgent(params);
    expect(r.degraded).toBe(true);
    expect(r.data.description.startsWith('fallback:')).toBe(true);
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ success: false, cached: false, inputTokens: 10 }));
    expect(setCached).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ agent: 'vacancy-writer', reason: 'invalid_output' }, expect.any(String));
  });

  it('a Bedrock timeout degrades to the fallback, logs success:false, and does not throw', async () => {
    vi.mocked(bedrockGenerate).mockRejectedValue(new BedrockTimeoutError(20_000));
    const r = await invokeAgent(params);
    expect(r).toMatchObject({ degraded: true, cached: false, data: { description: 'fallback:' } });
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ success: false, costUsd: 0 }));
    expect(setCached).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ agent: 'vacancy-writer', reason: 'timeout' }, expect.any(String));
  });

  it('other Bedrock errors still throw (fail closed)', async () => {
    vi.mocked(bedrockGenerate).mockRejectedValue(new Error('AWS Bedrock is temporarily unavailable (circuit open)'));
    await expect(invokeAgent(params)).rejects.toThrow('circuit open');
    expect(setCached).not.toHaveBeenCalled();
  });
});
