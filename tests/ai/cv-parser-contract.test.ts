import { beforeEach, describe, expect, it, vi } from 'vitest';

// The cv-parser output CONTRACT shared with the .NET 10 recovery parser
// (CvParsedResult.cs, asserted by CvParserContractTests over the SAME fixture file).
// Every case runs through the REAL invokeAgent → parseCV → candidateAiService.parseCV
// chain; only I/O is mocked. If this schema/extraction changes, the fixtures (and so the
// .NET side) must change with it.
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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type ContractCase = {
  name: string;
  modelText: string;
  valid: boolean;
  parsedData?: Record<string, unknown> & { education: unknown; languages: unknown };
};

const { cases } = JSON.parse(
  readFileSync(resolve(__dirname, '../../contracts/cv-parser-fixtures/cases.json'), 'utf8'),
) as { cases: ContractCase[] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkBudget).mockResolvedValue({ allowed: true, spent: 0, budget: 25 });
  vi.mocked(getCached).mockResolvedValue(null);
  vi.mocked(candidateRepository.findDocument).mockResolvedValue({ id: 'doc-1' } as never);
});

describe('cv-parser contract fixtures (shared with .NET)', () => {
  it('covers both outcomes', () => {
    expect(cases.filter((c) => c.valid).length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => !c.valid).length).toBeGreaterThanOrEqual(5);
  });

  it.each(cases.filter((c) => c.valid).map((c) => [c.name, c] as const))(
    'accepts %s and persists exactly the fixture parsed_data',
    async (_name, contract) => {
      vi.mocked(bedrockGenerate).mockResolvedValue({
        text: contract.modelText, inputTokens: 10, outputTokens: 5, model: 'haiku', latencyMs: 1,
      } as never);
      await candidateAiService.parseCV('org-1', 'cv text', 'doc-1', 'cand-1');
      expect(candidateRepository.updateDocumentParsedData).toHaveBeenCalledWith('doc-1', contract.parsedData);
      expect(candidateRepository.updateCandidateParsedFields).toHaveBeenCalledWith('org-1', 'cand-1', {
        education: contract.parsedData!.education,
        languages: contract.parsedData!.languages,
      });
    },
  );

  it.each(cases.filter((c) => !c.valid).map((c) => [c.name, c] as const))(
    'rejects %s without persisting anything',
    async (_name, contract) => {
      vi.mocked(bedrockGenerate).mockResolvedValue({
        text: contract.modelText, inputTokens: 10, outputTokens: 5, model: 'haiku', latencyMs: 1,
      } as never);
      await expect(candidateAiService.parseCV('org-1', 'cv text', 'doc-1', 'cand-1')).rejects.toThrow(
        'invalid structured output',
      );
      expect(candidateRepository.updateDocumentParsedData).not.toHaveBeenCalled();
      expect(logInvocation).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    },
  );
});
