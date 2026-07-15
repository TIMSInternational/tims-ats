import { describe, it, expect, vi } from 'vitest';

const invokeAgentMock = vi.fn();
vi.mock('../../packages/ai/src/invoke', () => ({ invokeAgent: (...a: unknown[]) => invokeAgentMock(...a) }));

import { answerCandidateFaq, type CandidateFaqContext } from '../../packages/ai/src/agents/candidate-faq';

const context: CandidateFaqContext = {
  organizationName: 'TIMS',
  candidateName: 'Ana Gomez',
  applications: [
    {
      id: 'app-1',
      vacancyTitle: 'Software Engineer',
      companyName: 'TIMS',
      status: 'active',
      currentStage: 'Interview',
      appliedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
  upcomingInterviews: [],
  offers: [],
};

describe('answerCandidateFaq', () => {
  it('routes through the candidate-faq agent with wrapped question + portal context', async () => {
    invokeAgentMock.mockResolvedValue({
      data: { answer: 'Your application is in interview.', sources: ['applications'] },
      model: 'haiku',
    });

    const result = await answerCandidateFaq('org-1', {
      question: 'What is my status?',
      context,
    });

    expect(invokeAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'candidate-faq',
        orgId: 'org-1',
        input: { question: 'What is my status?', context },
        maxTokens: 900,
      }),
    );

    const params = invokeAgentMock.mock.calls[0]![0] as {
      buildUserMessage: (input: { question: string; context: CandidateFaqContext }) => string;
    };
    const message = params.buildUserMessage({ question: 'What is my status?', context });
    expect(message).toContain('<candidate_question>');
    expect(message).toContain('<candidate_portal_context_json>');
    expect(message).toContain('Software Engineer');
    expect(result).toEqual({
      answer: 'Your application is in interview.',
      sources: ['applications'],
      model: 'haiku',
    });
  });

  it('uses a safe degraded fallback instead of returning malformed raw model text', async () => {
    invokeAgentMock.mockImplementation(async (params: { fallback: (raw: string) => unknown }) => ({
      data: params.fallback('raw untrusted prose'),
      model: 'haiku',
    }));

    const result = await answerCandidateFaq('org-1', { question: 'Help?', context });

    expect(result.answer).not.toContain('raw untrusted prose');
    expect(result.sources).toEqual([]);
  });
});
