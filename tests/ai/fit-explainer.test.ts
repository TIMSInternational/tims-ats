import { describe, it, expect, vi } from 'vitest';

const invokeAgentMock = vi.fn();
vi.mock('../../packages/ai/src/invoke', () => ({ invokeAgent: (...a: unknown[]) => invokeAgentMock(...a) }));

import { explainFit } from '../../packages/ai/src/agents/fit-explainer';

describe('explainFit', () => {
  it('invokes the fit-explainer agent slug with the breakdown as structured input', async () => {
    invokeAgentMock.mockResolvedValue({ data: { narrative: 'Strong technical match, light on required Spanish.' }, model: 'sonnet' });

    const result = await explainFit('org-1', {
      overallScore: 78,
      breakdown: {
        assessment: null, interview: 85, experience: 90, education: 100, languages: 40,
        llmJudgment: { score: 80, recommendation: 'advance', reasoning: 'Good communicator.', strengths: ['leadership'], gaps: ['Spanish fluency'] },
      },
      candidateName: 'Ana Gomez',
      vacancyTitle: 'Sales Director',
    });

    expect(invokeAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'fit-explainer', orgId: 'org-1' }),
    );
    expect(result.result.narrative).toContain('Strong technical match');
    expect(result.model).toBe('sonnet');
  });
});
