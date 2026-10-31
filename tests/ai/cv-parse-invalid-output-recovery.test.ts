import { beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end through the REAL invokeAgent → parseCV agent → candidateAiService.parseCV
// chain. Only I/O is mocked (Bedrock, budget, cache, usage log, registry id lookup,
// repository) so the test proves the PR's headline claim: malformed model output
// never persists `parsed: true`, so the document stays eligible for recovery.
vi.mock('../../packages/ai/src/client', () => ({
  bedrockGenerate: vi.fn(),
  calculateCost: vi.fn(() => 0.01),
}));
vi.mock('../../packages/ai/src/budget', () => ({ checkBudget: vi.fn() }));
vi.mock('../../packages/ai/src/cache', () => ({ getCached: vi.fn(), setCached: vi.fn() }));
vi.mock('../../packages/ai/src/logger', () => ({ logInvocation: vi.fn() }));
vi.mock('../../packages/ai/src/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/ai/src/registry')>()),
  resolveAgentId: vi.fn(async () => 'agent-uuid'),
}));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: {
    findDocument: vi.fn(),
    updateDocumentParsedData: vi.fn(),
    updateCandidateParsedFields: vi.fn(),
  },
}));

import { bedrockGenerate } from '../../packages/ai/src/client';
import { checkBudget } from '../../packages/ai/src/budget';
import { getCached, setCached } from '../../packages/ai/src/cache';
import { logInvocation } from '../../packages/ai/src/logger';
import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';
import { candidateAiService } from '../../packages/api/src/services/candidate-ai.service';

const VALID_CV = {
  name: 'Ana',
  email: null,
  phone: null,
  skills: ['typescript'],
  experience: [],
  education: [],
  languages: [],
  summary: null,
};

function bedrockReturns(text: string) {
  vi.mocked(bedrockGenerate).mockResolvedValue({
    text,
    inputTokens: 10,
    outputTokens: 5,
    model: 'haiku',
    latencyMs: 1,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkBudget).mockResolvedValue({ allowed: true, spent: 0, budget: 25 });
  vi.mocked(getCached).mockResolvedValue(null);
  vi.mocked(candidateRepository.findDocument).mockResolvedValue({ id: 'doc-1' } as never);
});

describe('CV parse with invalid model output', () => {
  it.each([
    ['no JSON at all', 'I cannot parse this document.'],
    ['JSON that fails the schema', '{"name": 42, "skills": "not-an-array"}'],
  ])('%s: rejects, leaves the document unparsed, and meters the call as unsuccessful', async (_label, text) => {
    bedrockReturns(text);

    await expect(candidateAiService.parseCV('org-1', 'cv text', 'doc-1', 'cand-1')).rejects.toThrow(
      'invalid structured output',
    );

    // parsedData is never written, so processCvUpload's `existing?.parsedData != null`
    // idempotency guard does not skip this document on a retry.
    expect(candidateRepository.updateDocumentParsedData).not.toHaveBeenCalled();
    expect(candidateRepository.updateCandidateParsedFields).not.toHaveBeenCalled();
    expect(setCached).not.toHaveBeenCalled();
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ success: false, cached: false }));
  });

  it('control: valid output persists parsed:true and meters success', async () => {
    bedrockReturns(JSON.stringify(VALID_CV));

    await candidateAiService.parseCV('org-1', 'cv text', 'doc-1', 'cand-1');

    expect(candidateRepository.updateDocumentParsedData).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ parsed: true, name: 'Ana' }),
    );
    expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ success: true, cached: false }));
  });
});
