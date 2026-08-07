import { describe, it, expect, vi, beforeEach } from 'vitest';

// #45: vacancy.create's autoPublish path now opens ONE runTenantTransaction, not
// tenantDb.$transaction (which does not compose — prisma/prisma#17948). The
// $transaction mock is kept so the "never called" assertions below are real
// assertions rather than missing-method crashes.
const runTenantTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@tims/db', () => ({
  tenantDb: {
    vacancy: {
      create: vi.fn(),
      update: vi.fn(),
    },
    publicationChannel: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(mockTx())
        : Promise.all(arg as Promise<unknown>[]),
    ),
  },
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: runTenantTransactionMock,
}));

function mockTx() {
  return {
    vacancy: {
      create: vi.fn().mockResolvedValue({
        id: 'vac-1',
        title: 'Sales Rep',
        status: 'approved',
        priority: 'medium',
        positions: 1,
        createdAt: new Date(),
      }),
      update: vi.fn().mockResolvedValue({
        id: 'vac-1',
        title: 'Sales Rep',
        status: 'published',
        priority: 'medium',
        positions: 1,
        createdAt: new Date(),
      }),
    },
    publicationChannel: { create: vi.fn().mockResolvedValue({ id: 'ch-1' }) },
  };
}

// Permission-aware mock: 'create' always allowed (the procedure-level check already
// passed by the time we're in the handler); 'publish' toggles per-test via
// setPublishAllowed, so the autoPublish branch's own vacancy:publish check (Codex
// PR #120 finding #1) can be exercised both ways.
const publishAllowed = vi.hoisted(() => ({ value: true }));
function setPublishAllowed(value: boolean) {
  publishAllowed.value = value;
}
const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async (_user: unknown, _module: string, action: string) =>
    action === 'publish'
      ? { allowed: publishAllowed.value, scope: 'organization', roles: ['recruiter'] }
      : { allowed: true, scope: 'organization', roles: ['recruiter'] },
  ),
);

vi.mock('../../packages/api/src/access/build', () => ({
  buildAccessForUser: buildAccessForUserMock,
}));
vi.mock('../../packages/api/src/access/anchors', () => ({
  createAnchorLoader: vi.fn().mockReturnValue(null),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: buildAccessForUserMock,
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setPublishAllowed(true);
  runTenantTransactionMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockTx()),
  );
});

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyCrudRouter } = await import('../../packages/api/src/routers/vacancy/crud');
  const testRouter = router({ vacancy: vacancyCrudRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'user-1',
      organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
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

describe('vacancy.create — autoPublish', () => {
  it('creates the vacancy pre-approved and auto-adds one internal channel when autoPublish is true', async () => {
    const { tenantDb } = await import('@tims/db');
    const caller = await makeCaller();

    await caller.vacancy.create({
      title: 'Sales Rep',
      positions: 1,
      priority: 'medium',
      settings: { autoPublish: true },
    });

    // #45: ONE real transaction (runTenantTransaction), and never the tenantDb
    // wrapper that does not roll back.
    expect(runTenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(runTenantTransactionMock).toHaveBeenCalledWith('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', expect.any(Function));
    expect(tenantDb.$transaction).not.toHaveBeenCalled();
  });

  it('leaves the vacancy in draft when requireApproval is true (no behavior change)', async () => {
    const { tenantDb } = await import('@tims/db');
    vi.mocked(tenantDb.vacancy.create).mockResolvedValue({
      id: 'vac-2',
      title: 'Ops Lead',
      status: 'draft',
      priority: 'medium',
      positions: 1,
      createdAt: new Date(),
    } as never);
    const caller = await makeCaller();

    const result = await caller.vacancy.create({
      title: 'Ops Lead',
      positions: 1,
      priority: 'medium',
      settings: { requireApproval: true },
    });

    expect(tenantDb.vacancy.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'draft' }) }),
    );
    expect(result.status).toBe('draft');
  });

  it('creates directly as approved when requireApproval is false/absent and autoPublish is off (no more draft dead end)', async () => {
    const { tenantDb } = await import('@tims/db');
    vi.mocked(tenantDb.vacancy.create).mockResolvedValue({
      id: 'vac-3',
      title: 'Support Analyst',
      status: 'approved',
      priority: 'medium',
      positions: 1,
      createdAt: new Date(),
    } as never);
    const caller = await makeCaller();

    const result = await caller.vacancy.create({
      title: 'Support Analyst',
      positions: 1,
      priority: 'medium',
    });

    expect(tenantDb.vacancy.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }),
    );
    expect(runTenantTransactionMock).not.toHaveBeenCalled();
    expect(tenantDb.$transaction).not.toHaveBeenCalled();
    expect(result.status).toBe('approved');
  });

  it('rejects autoPublish when the caller lacks vacancy:publish, without creating anything', async () => {
    const { tenantDb } = await import('@tims/db');
    setPublishAllowed(false);
    const caller = await makeCaller();

    await expect(
      caller.vacancy.create({
        title: 'Sales Rep',
        positions: 1,
        priority: 'medium',
        settings: { autoPublish: true },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(runTenantTransactionMock).not.toHaveBeenCalled();
    expect(tenantDb.$transaction).not.toHaveBeenCalled();
    expect(tenantDb.vacancy.create).not.toHaveBeenCalled();
  });

  it('rejects requireApproval:true combined with autoPublish:true as BAD_REQUEST', async () => {
    const { tenantDb } = await import('@tims/db');
    const caller = await makeCaller();

    await expect(
      caller.vacancy.create({
        title: 'Ops Lead',
        positions: 1,
        priority: 'medium',
        settings: { requireApproval: true, autoPublish: true },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(runTenantTransactionMock).not.toHaveBeenCalled();
    expect(tenantDb.$transaction).not.toHaveBeenCalled();
    expect(tenantDb.vacancy.create).not.toHaveBeenCalled();
  });
});
