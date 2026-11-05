import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

const mockOffer = {
  id: OFFER_ID,
  status: 'accepted',
  candidateId: 'cand-1',
  vacancyId: 'vac-1',
  applicationId: null,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  validations: [],
  legalChecks: [],
  candidate: { email: 'candidate@example.com', firstName: 'Ana', lastName: 'Lopez', phone: null, avatar: null },
  vacancy: { companyId: 'co-1', businessUnitId: 'bu-1', teamId: 'team-1' },
};

const mockTx = {
  user: { create: vi.fn().mockResolvedValue({ id: 'user-new-1', email: 'candidate@example.com' }) },
  userRole: { create: vi.fn() },
  userTeam: { create: vi.fn() },
  offer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  onboardingPlan: { create: vi.fn().mockResolvedValue({ id: 'plan-1' }) },
};

// The pilot hire-closure step has its own tests (tests/offer/hire-closure.test.ts); stub it here.
vi.mock('../../packages/api/src/services/hire-closure.service', () => ({
  closeHireRecords: vi.fn(async () => ({ applicationClosed: true, vacancyClosed: false })),
  HireRejectedApplicationError: class HireRejectedApplicationError extends Error {},
}));

// The rejected-application guard has its own tests (tests/offer/rejected-application-guard.test.ts); stub it here.
vi.mock('../../packages/api/src/routers/offer/rejected-application-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/api/src/routers/offer/rejected-application-guard')>()),
  assertApplicationNotRejected: vi.fn(async () => undefined),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    offer: { findFirst: vi.fn().mockResolvedValue(mockOffer), update: vi.fn() },
    offerApproval: { count: vi.fn().mockResolvedValue(0) },
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    role: { findFirst: vi.fn().mockResolvedValue({ id: 'employee-role-1' }) },
    hirePrediction: { findFirst: vi.fn().mockResolvedValue(null) },
    organization: { findFirst: vi.fn().mockResolvedValue({ name: 'Org', settings: {}, billingEmail: null }) },
    company: { findFirst: vi.fn().mockResolvedValue(null) },
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
  provisionStaffIdentity: vi.fn().mockResolvedValue({ supabaseUserId: 'supabase-uid-1', invited: true }),
}));
// The access email has its own tests (tests/offer/hire-access.test.ts).
vi.mock('../../packages/api/src/services/hire-access.service', () => ({
  deliverHireAccess: vi.fn(async (p: { email: string }) => ({ kind: 'invitation_sent', email: p.email })),
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
