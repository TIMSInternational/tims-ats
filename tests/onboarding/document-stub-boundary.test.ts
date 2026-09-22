import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

const assertScoped = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {},
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped,
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
  requireOrgScope: vi.fn(),
}));

const planId = '33333333-3333-3333-3333-333333333333';
const orgId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { onboardingRouter } = await import('../../packages/api/src/routers/onboarding');
  return createCallerFactory(router({ onboarding: onboardingRouter }))({
    user: { id: userId, organizationId: orgId, roles: ['hr_admin'], isPlatformOwner: false, impersonatorId: null, email: 'hr@example.com', isActive: true },
    headers: new Headers(), supabaseAuth: null, externalAuth: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  assertScoped.mockResolvedValue(undefined);
});

describe('onboarding endpoints without persistence', () => {
  it('refuses document requests instead of reporting false success', async () => {
    const api = await caller();
    await expect(api.onboarding.requestDocument({ planId, name: 'ID' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(api.onboarding.listDocuments({ planId })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    expect(assertScoped).toHaveBeenCalledWith('onboardingPlan', planId, expect.anything(), userId, orgId);
  });

  it('does not expose document-list or learning-route endpoints for another plan', async () => {
    assertScoped.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));
    const api = await caller();
    await expect(api.onboarding.listDocuments({ planId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(api.onboarding.getLearningRoute({ planId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports an unavailable learning route only after verifying the plan is in scope', async () => {
    const result = await (await caller()).onboarding.getLearningRoute({ planId });
    expect(assertScoped).toHaveBeenCalledWith('onboardingPlan', planId, expect.anything(), userId, orgId);
    expect(result.modules).toEqual([]);
  });
});
