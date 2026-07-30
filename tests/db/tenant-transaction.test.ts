import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTx = { $executeRaw: vi.fn().mockResolvedValue(1) };
const mockDb = {
  $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockTx)),
  $extends: vi.fn((ext) => mockDb),
};

vi.mock('../../packages/db/src/client', () => ({ db: mockDb }));

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockTx));
});

describe('runTenantTransaction', () => {
  it('sets RLS role + org GUC as the first two statements, then runs fn on the SAME tx, when RLS is enforced', async () => {
    vi.stubEnv('RLS_ENFORCED', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    const { runTenantTransaction } = await import('../../packages/db/src/tenant-client');

    const fn = vi.fn().mockResolvedValue('result');
    const result = await runTenantTransaction('org-1', fn);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith(mockTx);
    expect(result).toBe('result');
    vi.unstubAllEnvs();
  });

  it('skips SET LOCAL ROLE and runs fn directly outside production when RLS is not enforced', async () => {
    vi.stubEnv('RLS_ENFORCED', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    const { runTenantTransaction } = await import('../../packages/db/src/tenant-client');

    const fn = vi.fn().mockResolvedValue('result');
    await runTenantTransaction('org-1', fn);

    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledWith(mockTx);
    vi.unstubAllEnvs();
  });

  it('fails closed in production when RLS is not enforced', async () => {
    vi.stubEnv('RLS_ENFORCED', 'false');
    vi.stubEnv('NODE_ENV', 'production');
    const { runTenantTransaction } = await import('../../packages/db/src/tenant-client');

    await expect(runTenantTransaction('org-1', vi.fn())).rejects.toThrow(/RLS_ENFORCED must be "true" in production/);
    vi.unstubAllEnvs();
  });
});
