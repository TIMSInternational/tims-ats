import { describe, it, expect, vi, beforeEach } from 'vitest';

// End to end through the REAL cv-parser agent and the REAL invokeAgent: a
// Bedrock timeout must reject the parse, so the service never persists an empty
// fallback over a candidate's existing education/languages.
vi.mock('../../packages/ai/src/client', () => ({
  bedrockGenerate: vi.fn(),
  calculateCost: vi.fn(() => 0),
  maxCallUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 })),
  BedrockTimeoutError: class BedrockTimeoutError extends Error {},
}));
vi.mock('../../packages/ai/src/budget', () => ({
  checkBudget: vi.fn(async () => ({ allowed: true, spent: 0, budget: 25 })),
}));
vi.mock('../../packages/ai/src/cache', () => ({ getCached: vi.fn(async () => null), setCached: vi.fn() }));
vi.mock('../../packages/ai/src/logger', () => ({ logInvocation: vi.fn() }));
vi.mock('../../packages/ai/src/registry', () => ({
  resolveAgentId: vi.fn(async () => 'agent-uuid'),
  AGENT_REGISTRY: {},
}));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: {
    findDocument: vi.fn(async () => ({ id: 'doc-1' })),
    updateDocumentParsedData: vi.fn(),
    updateCandidateParsedFields: vi.fn(),
  },
}));

import { candidateAiService } from '../../packages/api/src/services/candidate-ai.service';
import { bedrockGenerate, BedrockTimeoutError } from '../../packages/ai/src/client';
import { logInvocation } from '../../packages/ai/src/logger';
import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

beforeEach(() => vi.clearAllMocks());

describe('CV parse failures never overwrite candidate data', () => {
  it('rejects and writes nothing to the document or the candidate', async () => {
    vi.mocked(bedrockGenerate).mockRejectedValue(new BedrockTimeoutError(20_000));

    await expect(candidateAiService.parseCV('org-1', 'cv text', 'doc-1', 'cand-1')).rejects.toBeInstanceOf(
      BedrockTimeoutError,
    );

    expect(candidateRepository.updateDocumentParsedData).not.toHaveBeenCalled();
    expect(candidateRepository.updateCandidateParsedFields).not.toHaveBeenCalled();
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('rejects and writes nothing when the model output exceeds the schema bounds', async () => {
    vi.mocked(bedrockGenerate).mockResolvedValue({
      text: JSON.stringify({
        name: null, email: null, phone: null, experience: [], education: [], languages: [], summary: null,
        skills: Array.from({ length: 101 }, (_, i) => `skill-${i}`),
      }),
      inputTokens: 1, outputTokens: 1, model: 'haiku', latencyMs: 1,
    });

    await expect(candidateAiService.parseCV('org-1', 'cv text', 'doc-1', 'cand-1')).rejects.toThrow('CV parser returned invalid structured output');

    expect(candidateRepository.updateDocumentParsedData).not.toHaveBeenCalled();
    expect(candidateRepository.updateCandidateParsedFields).not.toHaveBeenCalled();
  });
});
