import { describe, it, expect, vi, beforeEach } from 'vitest';

const aiAgentUpsert = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    aiAgent: {
      upsert: (...args: unknown[]) => aiAgentUpsert(...args),
    },
  },
}));

import { resolveAgentId } from '../../packages/ai/src/registry';

// A real agent invocation must promote a pre-existing 'stub' catalog row to
// 'active' — the seedAiAgents admin mutation can create a slug's row as 'stub'
// before that agent is ever invoked; once it IS invoked, the catalog must stop
// lying about it being a stub.
describe('resolveAgentId', () => {
  beforeEach(() => {
    aiAgentUpsert.mockReset();
    aiAgentUpsert.mockResolvedValue({ id: 'agent-uuid-1' });
  });

  it('upserts with an update clause that sets status to active (not a no-op)', async () => {
    await resolveAgentId('cv-parser');

    expect(aiAgentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'cv-parser' },
        update: { status: 'active' },
      }),
    );
  });

  it('creates a new row with status active when none exists', async () => {
    await resolveAgentId('candidate-screener');

    const call = aiAgentUpsert.mock.calls[0]?.[0];
    expect(call.create.status).toBe('active');
    expect(call.create.slug).toBe('candidate-screener');
  });

  it('falls back to generic defaults for a slug not in AGENT_REGISTRY', async () => {
    await resolveAgentId('some-unregistered-slug');

    const call = aiAgentUpsert.mock.calls[0]?.[0];
    expect(call.create.name).toBe('some-unregistered-slug');
    expect(call.create.category).toBe('general');
    expect(call.create.status).toBe('active');
  });

  it('memoizes the resolved id and does not upsert again for the same slug', async () => {
    const first = await resolveAgentId('vacancy-writer');
    const second = await resolveAgentId('vacancy-writer');

    expect(first).toBe(second);
    expect(aiAgentUpsert).toHaveBeenCalledTimes(1);
  });
});
