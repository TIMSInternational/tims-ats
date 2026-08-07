import { describe, it, expect, vi, beforeEach } from 'vitest';

// Codex PR #120 finding #4: channels.publish's channel-create + conditional
// vacancy-status-update must be ATOMIC (a regression here would silently reopen
// the finding). Mirrors the create-autopublish.test.ts mocking pattern.
//
// INVERTED 2026-08-06 (#45): this asserted `tenantDb.$transaction` was called, so
// it defended a wrapper that does not actually roll anything back — `db` here is
// `tenantDb`, whose extension re-wraps each op in its own mini-transaction, so the
// outer $transaction never composes (prisma/prisma#17948; reproduced on PG17).
// Finding #4 was therefore still open while this test was green.

const mockTx = () => ({
  publicationChannel: {
    create: vi
      .fn()
      .mockResolvedValue({ id: 'ch-1', channelName: 'LinkedIn', channelType: 'linkedin', status: 'published' }),
  },
  vacancy: {
    update: vi.fn().mockResolvedValue({ id: 'vac-1', status: 'published' }),
  },
});

const mockDb = vi.hoisted(() => ({
  vacancy: {
    findFirst: vi.fn(),
  },
  publicationChannel: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const runTenantTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: runTenantTransactionMock,
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['recruiter'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY_ID = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)(mockTx())
      : Promise.all(arg as Promise<unknown>[]),
  );
  runTenantTransactionMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockTx()),
  );
});

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyChannelsRouter } = await import('../../packages/api/src/routers/vacancy/channels');
  const testRouter = router({ vacancy: vacancyChannelsRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'user-1',
      organizationId: ORG_ID,
      roles: ['recruiter'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'r@tims.co',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('vacancy.channels.publish — transaction wrapper', () => {
  it('wraps the channel create + vacancy status update in runTenantTransaction (NOT tenantDb.$transaction) and flips status to published', async () => {
    mockDb.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'approved' });
    const caller = await makeCaller();

    const result = await caller.vacancy.publish({
      vacancyId: VACANCY_ID,
      channelName: 'LinkedIn',
      channelType: 'linkedin',
    });

    expect(runTenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(runTenantTransactionMock).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'ch-1', status: 'published' });
  });

  it('does not update vacancy status again when the vacancy is already published', async () => {
    mockDb.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'published' });
    const caller = await makeCaller();

    await caller.vacancy.publish({
      vacancyId: VACANCY_ID,
      channelName: 'Indeed',
      channelType: 'indeed',
    });

    expect(runTenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});
