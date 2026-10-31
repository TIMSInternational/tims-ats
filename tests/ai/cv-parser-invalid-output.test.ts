import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../packages/ai/src/invoke', () => ({ invokeAgent: vi.fn() }));

import { invokeAgent } from '../../packages/ai/src/invoke';
import { parseCV } from '../../packages/ai/src/agents/cv-parser';

beforeEach(() => vi.clearAllMocks());

describe('CV parser validation boundary', () => {
  it('does not present a fallback as a completed CV parse', async () => {
    vi.mocked(invokeAgent).mockResolvedValue({
      data: {
        name: null,
        email: null,
        phone: null,
        skills: [],
        experience: [],
        education: [],
        languages: [],
        summary: null,
      },
      model: 'haiku',
      cached: false,
      validated: false,
      inputTokens: 10,
      outputTokens: 10,
    } as never);

    await expect(parseCV('org-1', 'valid CV text')).rejects.toThrow('invalid structured output');
  });

  it('still accepts a validated sparse CV', async () => {
    vi.mocked(invokeAgent).mockResolvedValue({
      data: {
        name: null,
        email: null,
        phone: null,
        skills: [],
        experience: [],
        education: [],
        languages: [],
        summary: null,
      },
      model: 'haiku',
      cached: false,
      validated: true,
      inputTokens: 10,
      outputTokens: 10,
    } as never);

    const result = await parseCV('org-1', 'valid CV text');
    expect(result.confidence).toBe(0);
  });
});
