/**
 * entitlement.router.test.ts
 *
 * Router unit test for entitlement.mine (Task 6). Mocks the service layer
 * (getEntitlements) and drives the router directly via createCallerFactory,
 * mirroring the pattern in tests/access/ai-interview-router.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../packages/api/src/services/entitlement.service', () => ({
  getEntitlements: vi.fn().mockResolvedValue(
    new Map([
      ['ai_voice_interview', { moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 }],
      ['ai_screening', { moduleCode: 'ai_screening', limit: 100, unitPrice: null }],
    ]),
  ),
}));

import { getEntitlements } from '../../packages/api/src/services/entitlement.service';

async function makeCaller(overrideCtx?: Record<string, unknown>) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { entitlementRouter } = await import('../../packages/api/src/routers/entitlement');

  const testRouter = router({ entitlement: entitlementRouter });
  const callerFactory = createCallerFactory(testRouter);

  const baseCtx = {
    user: {
      id: 'user-uuid-1',
      organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      roles: ['super_admin'],
      isPlatformOwner: false,
      email: 'a@b.c',
      supabaseUserId: 's1',
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
    ...overrideCtx,
  };

  return callerFactory(baseCtx as never);
}

describe('entitlement.mine', () => {
  it('returns active module codes for the caller org', async () => {
    const caller = await makeCaller();
    const res = await caller.entitlement.mine();
    expect(res.modules).toContain('ai_voice_interview');
    expect(res.modules).toContain('ai_screening');
    expect(res.modules).toHaveLength(2);
  });

  it('calls getEntitlements with the caller org id (tenant isolation)', async () => {
    const caller = await makeCaller({
      user: {
        id: 'user-uuid-2',
        organizationId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        roles: [],
        isPlatformOwner: false,
        email: 'x@y.z',
        supabaseUserId: 's2',
      },
    });
    await caller.entitlement.mine();
    expect(vi.mocked(getEntitlements)).toHaveBeenCalledWith('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22');
  });

  it('throws UNAUTHORIZED when no user in context', async () => {
    const caller = await makeCaller({ user: null });
    await expect(caller.entitlement.mine()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
