import { describe, expect, it, vi } from 'vitest';

// #323: integration.getSystemHealth (permissionProcedure integration:read, reachable by any tenant holder)
// returned a hardcoded 'healthy' with 99.97% uptime. Nothing measures it, so it must say so.
vi.mock('@tims/db', () => ({
  db: {},
  tenantDb: {},
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { integrationRouter } = await import('../../packages/api/src/routers/integration');
  return createCallerFactory(router({ integration: integrationRouter }))({
    user: {
      id: '33333333-3333-3333-3333-333333333333',
      organizationId: '11111111-1111-1111-1111-111111111111',
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@example.com',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('tenant integration.getSystemHealth', () => {
  it('reports every service as unmonitored with no fabricated numbers', async () => {
    const health = await (await caller()).integration.getSystemHealth();
    expect(health).toEqual({
      status: 'unmonitored',
      uptime: null,
      latencyMs: null,
      activeConnections: null,
      services: {
        database: { status: 'unmonitored', latencyMs: null },
        redis: { status: 'unmonitored', latencyMs: null },
        storage: { status: 'unmonitored', latencyMs: null },
        email: { status: 'unmonitored', latencyMs: null },
      },
      lastCheckedAt: null,
    });
    expect(JSON.stringify(health)).not.toMatch(/healthy|99\.97/);
  });
});
