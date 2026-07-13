import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock by the SAME realpath the service resolves '@tims/ai' to (its index),
// so the mock intercepts the service's import and tsc can resolve the specifier.
vi.mock('../../packages/ai/src/index', () => ({ parseCV: vi.fn() }));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: { findDocument: vi.fn(), updateDocumentParsedData: vi.fn(), updateCandidateParsedFields: vi.fn() },
}));

import { candidateAiService } from '../../packages/api/src/services/candidate-ai.service';
import { parseCV as parseCVAgent } from '../../packages/ai/src/index';
import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

const ORG_ID = 'org-1';
const CANDIDATE_ID = 'cand-1';

const AGENT_RESULT = {
  data: {
    name: 'Ana Gómez', email: 'ana@example.com', phone: null,
    skills: ['typescript', 'react'], experience: [], education: [], languages: [], summary: null,
  },
  model: 'haiku',
  confidence: 0.5,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseCVAgent).mockResolvedValue(AGENT_RESULT as never);
});

describe('candidateAiService.parseCV', () => {
  it('parses text via the gated agent and returns parsed:true (no doc persist)', async () => {
    const r = await candidateAiService.parseCV('org-1', 'Ana Gómez — TypeScript dev');
    expect(parseCVAgent).toHaveBeenCalledWith('org-1', 'Ana Gómez — TypeScript dev');
    expect(r).toMatchObject({ name: 'Ana Gómez', skills: ['typescript', 'react'], confidence: 0.5, modelVersion: 'haiku', parsed: true });
    expect(candidateRepository.updateDocumentParsedData).not.toHaveBeenCalled();
  });

  it('persists the result to the document when a valid documentId is given', async () => {
    vi.mocked(candidateRepository.findDocument).mockResolvedValue({ id: 'doc-1' } as never);
    await candidateAiService.parseCV('org-1', 'cv text', 'doc-1');
    expect(candidateRepository.findDocument).toHaveBeenCalledWith('org-1', 'doc-1');
    expect(candidateRepository.updateDocumentParsedData).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ parsed: true, name: 'Ana Gómez' }),
    );
  });

  it('verifies document ownership BEFORE spending an AI call', async () => {
    vi.mocked(candidateRepository.findDocument).mockResolvedValue(null as never);
    await expect(candidateAiService.parseCV('org-1', 'cv text', 'doc-x')).rejects.toThrow();
    expect(parseCVAgent).not.toHaveBeenCalled();
  });

  it('promotes education and languages onto the Candidate row when candidateId is provided', async () => {
    vi.mocked(parseCVAgent).mockResolvedValue({
      data: {
        name: 'Ana Gomez', email: 'a@x.com', phone: null,
        skills: ['React'], experience: [],
        education: [{ institution: 'MIT', degree: 'Bachelor', year: 2020 }],
        languages: ['English', 'Spanish'], summary: 'x',
      },
      model: 'haiku', confidence: 0.9,
    } as never);

    await candidateAiService.parseCV(ORG_ID, 'cv text', undefined, CANDIDATE_ID);

    expect(candidateRepository.updateCandidateParsedFields).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, {
      education: [{ institution: 'MIT', degree: 'Bachelor', year: 2020 }],
      languages: ['English', 'Spanish'],
    });
  });

  it('does not touch the Candidate row when no candidateId is provided', async () => {
    vi.mocked(parseCVAgent).mockResolvedValue({
      data: {
        name: 'Ana Gomez', email: 'a@x.com', phone: null,
        skills: [], experience: [], education: [], languages: [], summary: 'x',
      },
      model: 'haiku', confidence: 0.9,
    } as never);

    await candidateAiService.parseCV(ORG_ID, 'cv text');

    expect(candidateRepository.updateCandidateParsedFields).not.toHaveBeenCalled();
  });
});
