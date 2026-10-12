import { describe, expect, it, vi } from 'vitest';

// PR #358 review fix: the tRPC rate-limit middleware must pass the credential-path
// outage policy through to checkRateLimit. Exercised through a real tRPC caller so a
// regression in trpc.ts (dropping `failClosed`) fails here, not only in the unit tests.

const checkRateLimit = vi.fn().mockResolvedValue(undefined);

vi.mock('@tims/db', () => ({
  db: {},
  tenantDb: {},
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

vi.mock('../../packages/api/src/access/security-audit', () => ({
  observeDenial: vi.fn(),
  observeExternalDenial: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../packages/api/src/middleware/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/api/src/middleware/rate-limit')>();
  return { ...actual, checkRateLimit: (...args: unknown[]) => checkRateLimit(...args) };
});

describe('withRateLimit passes the fail-closed policy for credential-like paths', () => {
  it('marks platform.acceptInvitation / resetUserPassword failClosed and ordinary paths not', async () => {
    const { router, publicProcedure, createCallerFactory } = await import('../../packages/api/src/trpc');
    const appRouter = router({
      platform: router({
        acceptInvitation: publicProcedure.mutation(() => 'ok'),
        resetUserPassword: publicProcedure.mutation(() => 'ok'),
      }),
      candidate: router({
        list: publicProcedure.query(() => 'ok'),
      }),
    });
    const caller = createCallerFactory(appRouter)({
      headers: new Headers({ 'x-real-ip': '203.0.113.9' }),
      user: null,
    } as never);

    await caller.platform.acceptInvitation();
    await caller.platform.resetUserPassword();
    await caller.candidate.list();

    expect(checkRateLimit.mock.calls).toEqual([
      [expect.any(String), 'mutation', { failClosed: true }],
      [expect.any(String), 'mutation', { failClosed: true }],
      [expect.any(String), 'query', { failClosed: false }],
    ]);
  });
});
