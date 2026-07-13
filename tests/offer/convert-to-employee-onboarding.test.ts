import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: trpc.ts's withTenantContext middleware validates organizationId against a
// strict UUID regex before it becomes the RLS GUC value — a non-UUID fixture like
// 'org-1' throws FORBIDDEN before the mutation body ever runs. Use real UUID-format
// strings for organizationId and for offerId (the input schema is z.string().uuid()).
const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OFFER_ID = '22222222-2222-2222-2222-222222222222';

const mockOffer = {
  id: OFFER_ID,
  status: 'accepted',
  candidate: { email: 'candidate@example.com', firstName: 'Ana', lastName: 'Lopez', phone: null, avatar: null },
  vacancy: { companyId: 'co-1', businessUnitId: 'bu-1', teamId: 'team-1' },
};

vi.mock('@tims/db', () => ({
  tenantDb: {
    offer: { findFirst: vi.fn().mockResolvedValue(mockOffer), update: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(mockTx) : Promise.all(arg as Promise<unknown>[])
    ),
  },
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

const mockTx = {
  user: { create: vi.fn().mockResolvedValue({ id: 'user-new-1', email: 'candidate@example.com' }) },
  userTeam: { create: vi.fn() },
  offer: { update: vi.fn() },
  onboardingPlan: { create: vi.fn().mockResolvedValue({ id: 'plan-1' }) },
};

vi.mock('../../packages/api/src/services/staff-provisioning.service', () => ({
  resolveStaffSupabaseUserId: vi.fn().mockResolvedValue('supabase-uid-1'),
}));

vi.mock('../../packages/api/src/services/hire-prediction.service', () => ({
  hirePredictionService: {
    readFitForHire: vi.fn().mockResolvedValue(null),
    writeSnapshot: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../packages/api/src/access/build', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
}));
vi.mock('../../packages/api/src/access/anchors', () => ({
  createAnchorLoader: vi.fn().mockReturnValue(null),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => vi.clearAllMocks());

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerLifecycleRouter } = await import('../../packages/api/src/routers/offer/lifecycle');
  const testRouter = router({ offer: offerLifecycleRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'hr-1', organizationId: ORG_ID, roles: ['hr_admin'],
      isPlatformOwner: false, impersonatorId: null, email: 'hr@tims.co', isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('offer.convertToEmployee — onboarding plan creation', () => {
  it('creates an OnboardingPlan with the default task set in the same transaction', async () => {
    const caller = await makeCaller();

    await caller.offer.convertToEmployee({ offerId: OFFER_ID, jobTitle: 'Account Executive' });

    expect(mockTx.onboardingPlan.create).toHaveBeenCalledTimes(1);
    const arg = mockTx.onboardingPlan.create.mock.calls[0][0];
    expect(arg.data.userId).toBe('user-new-1');
    expect(arg.data.organizationId).toBe(ORG_ID);
    expect(arg.data.phase).toBe('day1_30');
    expect(arg.data.tasks.create.length).toBeGreaterThanOrEqual(8);
    expect(arg.data.tasks.create.every((t: { organizationId: string }) => t.organizationId === ORG_ID)).toBe(true);
  });
});
