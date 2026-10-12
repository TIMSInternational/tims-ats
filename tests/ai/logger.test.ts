import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('@tims/db', () => ({ db: { aiAgentUsageLog: { create: (...a: unknown[]) => create(...a) } } }));

import { logInvocation } from '../../packages/ai/src/logger';

const base = {
  agentId: 'agent-uuid',
  organizationId: 'org-1',
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.01,
  latencyMs: 100,
  model: 'haiku',
};

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: 'log-1' });
});

describe('logInvocation', () => {
  it.each([true, false])('persists success=%s so a malformed invocation is distinguishable', async (success) => {
    await logInvocation({ ...base, success });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success, cached: false }) }),
    );
  });

  it('selects only the id (no implicit RETURNING of every column)', async () => {
    await logInvocation({ ...base, success: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
  });

  it('never fails the caller when the write fails', async () => {
    create.mockRejectedValue(new Error('column "success" does not exist'));
    await expect(logInvocation({ ...base, success: true })).resolves.toBeUndefined();
  });
});
