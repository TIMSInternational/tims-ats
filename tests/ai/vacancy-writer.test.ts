import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same gate-mocking convention as tests/ai/invoke.test.ts: mock every
// dependency of invokeAgent's gated path so we exercise the REAL
// generateVacancyDescription (and therefore its real prompt/schema) without
// touching Bedrock, budget, cache, or the DB.
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

import { generateVacancyDescription } from '../../packages/ai/src/agents/vacancy-writer';
import { bedrockGenerate } from '../../packages/ai/src/client';
import { checkBudget } from '../../packages/ai/src/budget';
import { getCached } from '../../packages/ai/src/cache';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkBudget).mockResolvedValue({ allowed: true, spent: 0, budget: 25 });
  vi.mocked(getCached).mockResolvedValue(null);
});

const VALID_PAYLOAD = {
  formal: {
    description: 'Full markdown job description for a formal posting',
    sections: {
      responsibilities: ['Lead the backend team'],
      requirements: ['5+ years experience'],
      benefits: ['Health insurance'],
    },
  },
  social: { description: 'Short, punchy social post version.' },
  whatsapp: { description: 'Hola! Buscamos backend engineer, escribinos.' },
};

describe('generateVacancyDescription (vacancy-writer agent)', () => {
  it('makes exactly ONE Bedrock call and returns formal/social/whatsapp variants', async () => {
    vi.mocked(bedrockGenerate).mockResolvedValue({
      text: JSON.stringify(VALID_PAYLOAD),
      inputTokens: 20,
      outputTokens: 40,
      model: 'sonnet',
      latencyMs: 500,
    });

    const result = await generateVacancyDescription('org-1', 'Backend Engineer', 'Remote, fintech');

    expect(bedrockGenerate).toHaveBeenCalledTimes(1);
    expect(result.formal.description).toBe(VALID_PAYLOAD.formal.description);
    expect(result.formal.sections.responsibilities).toEqual(['Lead the backend team']);
    expect(result.formal.sections.requirements).toEqual(['5+ years experience']);
    expect(result.formal.sections.benefits).toEqual(['Health insurance']);
    expect(result.social.description).toBe(VALID_PAYLOAD.social.description);
    expect(result.whatsapp.description).toBe(VALID_PAYLOAD.whatsapp.description);
    expect(result.model).toBe('sonnet');
    expect(result.tokensUsed).toBe(60);
  });

  it('asks for all 3 variants in the system prompt and includes title/context in the user message', async () => {
    vi.mocked(bedrockGenerate).mockResolvedValue({
      text: JSON.stringify(VALID_PAYLOAD),
      inputTokens: 1,
      outputTokens: 1,
      model: 'sonnet',
      latencyMs: 1,
    });

    await generateVacancyDescription('org-1', 'Backend Engineer', 'Remote, fintech');

    const [, systemPrompt, userMessage] = vi.mocked(bedrockGenerate).mock.calls[0]!;
    expect(systemPrompt).toMatch(/formal/i);
    expect(systemPrompt).toMatch(/social/i);
    expect(systemPrompt).toMatch(/whatsapp/i);
    expect(userMessage).toContain('Backend Engineer');
    expect(userMessage).toContain('Remote, fintech');
  });

  it('falls back to a degraded-but-usable 3-variant shape when Bedrock returns unparseable output', async () => {
    vi.mocked(bedrockGenerate).mockResolvedValue({
      text: 'totally not json',
      inputTokens: 5,
      outputTokens: 5,
      model: 'sonnet',
      latencyMs: 1,
    });

    const result = await generateVacancyDescription('org-1', 'Backend Engineer');

    expect(result.formal.description).toContain('totally not json');
    expect(result.formal.sections).toEqual({ responsibilities: [], requirements: [], benefits: [] });
    expect(result.social.description).toBeTruthy();
    expect(result.whatsapp.description).toBeTruthy();
  });
});
