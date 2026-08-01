import { describe, it, expect, vi } from 'vitest';

const invokeAgentMock = vi.fn();
vi.mock('../../packages/ai/src/invoke', () => ({ invokeAgent: (...a: unknown[]) => invokeAgentMock(...a) }));

import { matchCandidate } from '../../packages/ai/src/agents/candidate-matcher';

describe('matchCandidate', () => {
  it('invokes the candidate-matcher agent slug with the candidate profile + bounded vacancy set as structured input', async () => {
    invokeAgentMock.mockResolvedValue({
      data: {
        recommendedVacancies: [{ vacancyId: 'v1', matchScore: 88 }],
        suggestedActions: ['Schedule technical assessment'],
      },
      model: 'sonnet',
    });

    const result = await matchCandidate('org-1', {
      candidateProfile: { name: 'Ana Gomez', title: 'Backend Dev', skills: ['ts', 'node'], experience: 5 },
      vacancies: [
        { id: 'v1', title: 'Senior Backend Engineer' },
        { id: 'v2', title: 'Frontend Engineer' },
      ],
    });

    expect(invokeAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'candidate-matcher', orgId: 'org-1' }),
    );
    expect(result.result.recommendedVacancies).toEqual([{ vacancyId: 'v1', matchScore: 88 }]);
    expect(result.model).toBe('sonnet');
  });

  it('bounds the built user message to the provided vacancy ids (no ids invented in the prompt itself)', async () => {
    invokeAgentMock.mockResolvedValue({
      data: { recommendedVacancies: [], suggestedActions: ['Request updated CV'] },
      model: 'sonnet',
    });

    await matchCandidate('org-1', {
      candidateProfile: { name: 'Ana Gomez' },
      vacancies: [{ id: 'v1', title: 'Senior Backend Engineer' }],
    });

    const params = invokeAgentMock.mock.calls[0][0];
    const message = params.buildUserMessage(params.input);
    expect(message).toContain('v1');
    expect(message).toContain('Senior Backend Engineer');
  });
});
