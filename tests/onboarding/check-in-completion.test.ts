import { beforeEach, describe, expect, it, vi } from 'vitest';

const findCheckIn = vi.fn();
const updateCheckIn = vi.fn();
const assertScoped = vi.fn();
const orgId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const planId = '33333333-3333-3333-3333-333333333333';
const checkInId = '44444444-4444-4444-4444-444444444444';

vi.mock('@tims/db', () => ({
  tenantDb: { onboardingCheckIn: { findFirst: findCheckIn, update: updateCheckIn } },
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
  findCheckIn.mockResolvedValue({ id: checkInId, planId, status: 'pending' });
  updateCheckIn.mockResolvedValue({ id: checkInId, status: 'completed' });
});

describe('complete onboarding check-in', () => {
  it('stores completion against a tenant-scoped pending check-in', async () => {
    await (await caller()).onboarding.completeCheckIn({ id: checkInId, notes: 'Welcome', score: 8 });
    expect(findCheckIn).toHaveBeenCalledWith(expect.objectContaining({ where: { id: checkInId, organizationId: orgId } }));
    expect(assertScoped).toHaveBeenCalledWith('onboardingPlan', planId, expect.anything(), userId, orgId);
    expect(updateCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: checkInId },
      data: expect.objectContaining({ status: 'completed', notes: 'Welcome', score: 8, completedById: userId }),
    }));
  });

  it('does not overwrite an already completed check-in', async () => {
    findCheckIn.mockResolvedValue({ id: checkInId, planId, status: 'completed' });
    await expect((await caller()).onboarding.completeCheckIn({ id: checkInId })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(updateCheckIn).not.toHaveBeenCalled();
  });
});
