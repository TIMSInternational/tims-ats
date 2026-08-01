import { describe, it, expect, vi } from 'vitest';

const invokeAgentMock = vi.fn();
vi.mock('../../packages/ai/src/invoke', () => ({ invokeAgent: (...a: unknown[]) => invokeAgentMock(...a) }));

import { suggestNextBestAction } from '../../packages/ai/src/agents/pipeline-optimizer';

describe('suggestNextBestAction', () => {
  it('invokes the pipeline-optimizer agent slug with the application context as structured input', async () => {
    invokeAgentMock.mockResolvedValue({
      data: {
        recommendation: 'Programar entrevista tecnica',
        confidence: 0.82,
        suggestedActions: [{ action: 'schedule_interview', label: 'Programar entrevista', priority: 'high' }],
      },
      model: 'sonnet',
    });

    const result = await suggestNextBestAction('org-1', {
      candidateName: 'Ana Gomez',
      currentStageName: 'Entrevistas',
      currentStageOrder: 3,
    });

    expect(invokeAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'pipeline-optimizer', orgId: 'org-1' }),
    );
    expect(result.result.recommendation).toBe('Programar entrevista tecnica');
    expect(result.result.suggestedActions).toHaveLength(1);
    expect(result.model).toBe('sonnet');
  });
});
