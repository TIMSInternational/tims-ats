import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// F15a: tenantDb used to run a query UNSCOPED on the privileged BYPASSRLS login role whenever
// no org was in scope — any caller that forgot runWithTenant silently read/wrote across
// tenants. It now fails closed; the only way to run without a tenant is the explicit, named
// runUnscoped(reason, …) opt-in.

type AllOps = (p: {
  model: string | undefined;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

let captured: AllOps | undefined;
const mockDb = {
  $executeRaw: vi.fn(() => Promise.resolve(1)),
  $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  $extends: vi.fn((ext: { query: { $allOperations: AllOps } }) => {
    captured = ext.query.$allOperations;
    return mockDb;
  }),
};

vi.mock('../../packages/db/src/client', () => ({ db: mockDb }));

async function load() {
  vi.resetModules();
  captured = undefined;
  const client = await import('../../packages/db/src/tenant-client');
  const ctx = await import('../../packages/db/src/tenant-context');
  if (!captured) throw new Error('tenantDb extension was not registered');
  return { ...client, ...ctx, allOps: captured };
}

function op(allOps: AllOps, query = vi.fn(async (a: unknown) => ({ ran: a }))) {
  return { query, run: () => allOps({ model: 'Candidate', operation: 'findMany', args: { where: {} }, query }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => vi.unstubAllEnvs());

describe('tenantDb — fail closed without a tenant', () => {
  it('throws MissingTenantContextError and never runs the query when no context is set', async () => {
    vi.stubEnv('RLS_ENFORCED', 'true');
    const { allOps, MissingTenantContextError } = await load();
    const { query, run } = op(allOps);

    await expect(run()).rejects.toBeInstanceOf(MissingTenantContextError);
    await expect(run()).rejects.toThrow(/Candidate\.findMany with no tenant in scope/);
    expect(query).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('throws for runWithTenant(null) too — a null org is not an opt-in', async () => {
    vi.stubEnv('RLS_ENFORCED', 'true');
    const { allOps, runWithTenant, MissingTenantContextError } = await load();
    const { query, run } = op(allOps);

    await expect(runWithTenant(null, run)).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed even when RLS_ENFORCED is off (dev/test no longer get a silent unscoped path)', async () => {
    vi.stubEnv('RLS_ENFORCED', 'false');
    const { allOps, MissingTenantContextError } = await load();
    const { query, run } = op(allOps);

    await expect(run()).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('tenantDb — scoped with a tenant', () => {
  it('sets SET LOCAL ROLE app_tenant + the org GUC in the same transaction as the query', async () => {
    vi.stubEnv('RLS_ENFORCED', 'true');
    const { allOps, runWithTenant } = await load();
    const { query, run } = op(allOps);

    const result = await runWithTenant('11111111-1111-1111-1111-111111111111', run);

    expect(result).toEqual({ ran: { where: {} } });
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    const batch = mockDb.$transaction.mock.calls[0]![0];
    expect(batch).toHaveLength(3);
    const rawSql = mockDb.$executeRaw.mock.calls.map((c) => (c as unknown[])[0] as TemplateStringsArray);
    expect(rawSql[0]!.join('')).toContain('SET LOCAL ROLE app_tenant');
    expect(rawSql[1]!.join('')).toContain("set_config('app.current_org_id'");
    expect(mockDb.$executeRaw.mock.calls[1]).toContain('11111111-1111-1111-1111-111111111111');
  });
});

describe('tenantDb — explicit runUnscoped opt-in', () => {
  it('runs the query unscoped (no role drop, no GUC) inside runUnscoped and exposes the reason', async () => {
    vi.stubEnv('RLS_ENFORCED', 'true');
    const { allOps, runUnscoped, getUnscopedReason } = await load();
    const { query, run } = op(allOps);

    const result = await runUnscoped('platform-owner-without-org', async () => {
      expect(getUnscopedReason()).toBe('platform-owner-without-org');
      return run();
    });

    expect(result).toEqual({ ran: { where: {} } });
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();
    expect(getUnscopedReason()).toBeNull();
  });

  it('requires a non-empty reason', async () => {
    const { runUnscoped } = await load();
    expect(() => runUnscoped('   ', () => 1)).toThrow(/non-empty reason/);
  });

  it('a nested runWithTenant inside runUnscoped is scoped again (opt-in does not leak inward)', async () => {
    vi.stubEnv('RLS_ENFORCED', 'true');
    const { allOps, runUnscoped, runWithTenant, getUnscopedReason } = await load();
    const { run } = op(allOps);

    await runUnscoped('offer-signing-token', () =>
      runWithTenant('22222222-2222-2222-2222-222222222222', async () => {
        expect(getUnscopedReason()).toBeNull();
        await run();
      }),
    );
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });
});
