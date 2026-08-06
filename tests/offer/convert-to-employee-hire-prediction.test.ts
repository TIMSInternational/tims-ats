import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OFFER_ID = '22222222-2222-2222-2222-222222222222';

const mockOffer = {
  id: OFFER_ID,
  status: 'accepted',
  candidateId: 'cand-1',
  vacancyId: 'vac-1',
  applicationId: null,
  candidate: { email: 'candidate@example.com', firstName: 'Ana', lastName: 'Lopez', phone: null, avatar: null },
  vacancy: { companyId: 'co-1', businessUnitId: 'bu-1', teamId: 'team-1' },
};

const mockTx = {
  user: { create: vi.fn().mockResolvedValue({ id: 'user-new-1', email: 'candidate@example.com' }) },
  userTeam: { create: vi.fn() },
  offer: { update: vi.fn() },
  onboardingPlan: { create: vi.fn().mockResolvedValue({ id: 'plan-1' }) },
};

vi.mock('@tims/db', () => ({
  tenantDb: {
    offer: { findFirst: vi.fn().mockResolvedValue(mockOffer), update: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(mockTx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  },
  runWithTenant: (_o: string, f: () => unknown) => f(),
  // #45: convertToEmployee's multi-write hire flow now uses runTenantTransaction —
  // tenantDb.$transaction never composed (prisma/prisma#17948). The FIT snapshot
  // below must share that one transaction with the user/plan/offer writes.
  runTenantTransaction: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const readFitForHire = vi.fn().mockResolvedValue(null);
const writeSnapshot = vi.fn().mockResolvedValue(undefined);
vi.mock('../../packages/api/src/services/hire-prediction.service', () => ({
  hirePredictionService: {
    readFitForHire: (...a: unknown[]) => readFitForHire(...a),
    writeSnapshot: (...a: unknown[]) => writeSnapshot(...a),
  },
}));

vi.mock('../../packages/api/src/services/staff-provisioning.service', () => ({
  resolveStaffSupabaseUserId: vi.fn().mockResolvedValue('supabase-uid-1'),
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
      id: 'hr-1',
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@tims.co',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('offer.convertToEmployee — hire prediction snapshot', () => {
  it('captures a HirePrediction inside the tx with the new user + offer ids', async () => {
    const caller = await makeCaller();

    await caller.offer.convertToEmployee({ offerId: OFFER_ID, jobTitle: 'Account Executive' });

    expect(readFitForHire).toHaveBeenCalledTimes(1);
    expect(readFitForHire).toHaveBeenCalledWith(ORG_ID, 'cand-1', 'vac-1');

    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    const [passedTx, params] = writeSnapshot.mock.calls[0];
    expect(passedTx).toBe(mockTx); // called inside the transaction
    expect(params).toEqual({
      organizationId: ORG_ID,
      userId: 'user-new-1',
      candidateId: 'cand-1',
      vacancyId: 'vac-1',
      offerId: OFFER_ID,
      applicationId: null,
      hiredById: 'hr-1',
      fitScore: null,
    });
  });
});
