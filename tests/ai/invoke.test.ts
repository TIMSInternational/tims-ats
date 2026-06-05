import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock every dependency of the gated path so we test the orchestration logic
// (order, fail-closed, fail-soft, cache short-circuit) without Bedrock or a DB.
vi.mock('../../packages/ai/src/client', () => ({
  bedrockGenerate: vi.fn(),
  calculateCost: vi.fn(() => 0.01),
}));
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
import { bedrockGenerate } from '../../packages/ai/src/client';
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
});
