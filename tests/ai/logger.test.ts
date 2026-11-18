import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const warn = vi.fn();
vi.mock('@tims/db', () => ({ db: { aiAgentUsageLog: { create: (...a: unknown[]) => create(...a) } } }));
vi.mock('@tims/shared', () => ({ logger: { warn: (...a: unknown[]) => warn(...a) } }));

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

function prismaError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

beforeEach(() => {
  create.mockReset();
  warn.mockReset();
  create.mockResolvedValue({ id: 'log-1' });
});

describe('logInvocation', () => {
  it.each([true, false])('persists success=%s so a malformed invocation is distinguishable', async (success) => {
    await logInvocation({ ...base, success });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success, cached: false }) }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('selects only the id (no implicit RETURNING of every column)', async () => {
    await logInvocation({ ...base, success: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
  });

  it('deploy-before-DDL (P2022): retries without `success` so the cost row is NOT lost', async () => {
    create.mockRejectedValueOnce(prismaError('P2022', 'The column `success` does not exist'));
    await expect(logInvocation({ ...base, success: true })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1]?.[0] as { data: Record<string, unknown>; select: unknown };
    expect(retry.data).not.toHaveProperty('success');
    expect(retry.data).toMatchObject({ costUsd: 0.01, organizationId: 'org-1', agentId: 'agent-uuid' });
    expect(retry.select).toEqual({ id: true });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'P2022' }), expect.any(String));
  });

  it('a non-P2022 failure is swallowed but made visible (warn with code, no message)', async () => {
    create.mockRejectedValue(prismaError('P1001', 'cannot reach db at secret-host'));
    await expect(logInvocation({ ...base, success: true })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ code: 'P1001', organizationId: 'org-1' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-host');
  });

  it('a failing retry is also swallowed and warned', async () => {
    create.mockRejectedValue(prismaError('P2022', 'The column `success` does not exist'));
    await expect(logInvocation({ ...base, success: true })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
