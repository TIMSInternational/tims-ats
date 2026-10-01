/**
 * #323: router-level proof that the DB-down state is reachable. Before the fix the counts ran in an
 * unguarded Promise.all, so when SELECT 1 failed the counts threw too and the procedure returned 500 —
 * the page showed ErrorState and the 'down' banner could never render.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@tims/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ warn, info: vi.fn(), error: vi.fn() }) },
}));

const dbMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  user: { count: vi.fn() },
  organization: { count: vi.fn() },
  auditLog: { count: vi.fn(), findMany: vi.fn() },
  vacancy: { count: vi.fn() },
}));

vi.mock('@tims/db', () => ({
  db: dbMock,
  tenantDb: dbMock,
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runUnscoped: (_reason: string, fn: () => unknown) => fn(),
}));

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { systemRouter } = await import('../../packages/api/src/routers/platform/system');
  return createCallerFactory(router({ platform: systemRouter }))({
    user: {
      id: 'platform-user-1',
      email: 'owner@tims.test',
      supabaseUserId: 's-owner-1',
      roles: ['platform_owner'],
      isPlatformOwner: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

const dbDown = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432 user=alice@acme.test'));

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  dbMock.user.count.mockResolvedValue(10);
  dbMock.organization.count.mockResolvedValue(2);
  dbMock.auditLog.count.mockResolvedValue(3);
  dbMock.vacancy.count.mockResolvedValue(4);
  dbMock.auditLog.findMany.mockResolvedValue([]);
});

describe('platform.getSystemHealth (router)', () => {
  it('returns the down state, not a 500, when the database is unreachable', async () => {
    for (const fn of [dbMock.$queryRaw, dbMock.user.count, dbMock.organization.count, dbMock.auditLog.count,
      dbMock.vacancy.count, dbMock.auditLog.findMany]) {
      fn.mockImplementation(dbDown);
    }
    const health = await (await makeCaller()).platform.getSystemHealth();

    expect(health.overall).toBe('down');
    expect(health.services.find((service) => service.id === 'database')?.status).toBe('down');
    expect(health.stats).toEqual({ userCount: null, orgCount: null, loginsToday: null, auditLogsToday: null });
    // Unavailable (null), not "no errors" ([]).
    expect(health.recentErrors).toBeNull();
    // Nothing else is queried once the probe failed.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toEqual({ module: 'platform_health', probe: 'select1', error: 'Error' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('alice');
    expect(dbMock.user.count).not.toHaveBeenCalled();
    expect(dbMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('degrades (does not fail) when the probe succeeds but one count throws', async () => {
    dbMock.vacancy.count.mockImplementation(dbDown);
    const health = await (await makeCaller()).platform.getSystemHealth();

    expect(health.services.find((service) => service.id === 'database')?.status).toBe('degraded');
    expect(health.overall).toBe('degraded');
    expect(health.stats.userCount).toBe(10);
  });

  it('reports recent errors as unavailable (null) when only the audit feed fails, and logs it by name', async () => {
    dbMock.auditLog.findMany.mockImplementation(dbDown);
    const health = await (await makeCaller()).platform.getSystemHealth();
    expect(health.recentErrors).toBeNull();
    expect(warn).toHaveBeenCalledWith({ module: 'platform_health', probe: 'recentErrors', error: 'Error' }, expect.any(String));
  });

  it('keeps the measured state when everything answers', async () => {
    const health = await (await makeCaller()).platform.getSystemHealth();
    expect(health.services.find((service) => service.id === 'database')?.status).toBe('operational');
    expect(health.stats).toEqual({ userCount: 10, orgCount: 2, loginsToday: 10, auditLogsToday: 3 });
    expect(health.overall).toBe('unmonitored');
    expect(health.recentErrors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
