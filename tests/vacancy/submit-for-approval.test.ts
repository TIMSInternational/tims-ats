import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// Permission-aware mock: 'update' (the procedure-level gate) always allowed;
// 'approve' toggles per-test via setApproverAllowed, so submitForApproval's
// per-approverId vacancy:approve check (Codex PR #120 finding #3) can be
// exercised both ways.
const approverAllowed = vi.hoisted(() => ({ value: true }));
function setApproverAllowed(value: boolean) {
  approverAllowed.value = value;
}
// Scope of the approver's vacancy:approve grant — 'organization' by default (the
// common case), overridden to a narrower rung (e.g. 'team') by the round-2 scope
// test so the mock reflects a genuinely scope-limited approver, not just a stub.
const approverScope = vi.hoisted(() => ({ value: 'organization' as string }));
function setApproverScope(scope: string) {
  approverScope.value = scope;
}
const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async (_user: unknown, _module: string, action: string) =>
    action === 'approve'
      ? { allowed: approverAllowed.value, scope: approverScope.value, roles: ['committee'] }
      : { allowed: true, scope: 'organization', roles: ['recruiter'] },
  ),
);

// createAnchorLoader is called once per approver with (organizationId, approverId)
// (Codex PR #120 round-2: the anchors must be the APPROVER's own, not the caller's).
// Return a value tagged with the userId so assertions can confirm the right
// approver's anchors reached assertScoped, not a shared/caller loader.
const createAnchorLoaderMock = vi.hoisted(() =>
  vi.fn((_organizationId: string, userId: string) => ({ __forUserId: userId })),
);

// assertScoped is called twice per approver in submitForApproval: once up front for
// the SUBMITTING caller (ctx.access, ctx.user.id) and once per approver (Codex PR
// #120 round-2: the per-vacancy scope probe on the APPROVER's own access). Reject
// only when called with a specific userId so tests can target just the approver
// probe without breaking the caller's own scope check. NOT_FOUND matches what the
// real assertScoped throws for scope denial (approvals.ts narrows its catch on
// exactly that code) — a generic Error would NOT be converted to BAD_REQUEST.
const scopeRejectedForUserId = vi.hoisted(() => ({ value: null as string | null }));
function rejectScopeForUserId(userId: string | null) {
  scopeRejectedForUserId.value = userId;
}
const assertScopedMock = vi.hoisted(() =>
  vi.fn(async (_entity: string, _id: string, _access: unknown, userId: string) => {
    if (scopeRejectedForUserId.value !== null && userId === scopeRejectedForUserId.value) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'out of scope' });
    }
  }),
);

const mockDb = vi.hoisted(() => ({
  vacancy: {
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  vacancyApproval: {
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

vi.mock('@tims/shared', async (importOriginal) => ({
  // Preserve the real module (mfa gate helpers now imported by trpc.ts, Module/Action
  // types, etc.); only override filterStaffRoleSlugs for this test.
  ...(await importOriginal<typeof import('@tims/shared')>()),
  filterStaffRoleSlugs: (slugs: string[]) =>
    slugs.filter((s) => ['super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader', 'committee', 'employee'].includes(s)),
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: buildAccessForUserMock,
  createAnchorLoader: createAnchorLoaderMock,
  assertScoped: assertScopedMock,
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setApproverAllowed(true);
  setApproverScope('organization');
  rejectScopeForUserId(null);

  mockDb.vacancy.findFirst.mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999' });
  mockDb.vacancy.findUniqueOrThrow.mockResolvedValue({
    id: '99999999-9999-4999-8999-999999999999', title: 'Sales Rep', status: 'pending_approval', approvals: [],
  });
  mockDb.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)({
          vacancy: mockDb.vacancy,
          vacancyApproval: mockDb.vacancyApproval,
        })
      : Promise.all(arg as Promise<unknown>[]),
  );
});

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const APPROVER_ID = '11111111-1111-1111-1111-111111111111';

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyApprovalsRouter } = await import('../../packages/api/src/routers/vacancy/approvals');
  const testRouter = router({ vacancy: vacancyApprovalsRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'user-1', organizationId: ORG_ID, roles: ['recruiter'],
      isPlatformOwner: false, impersonatorId: null, email: 'r@tims.co', isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('vacancy.submitForApproval — approver validation', () => {
  it('submits successfully when the approver is active, same-org, and holds vacancy:approve', async () => {
    mockDb.user.findMany.mockResolvedValue([
      { id: APPROVER_ID, userRoles: [{ role: { slug: 'committee' } }] },
    ]);
    const caller = await makeCaller();

    await expect(
      caller.vacancy.submitForApproval({ id: '99999999-9999-4999-8999-999999999999', approverIds: [APPROVER_ID] }),
    ).resolves.toBeDefined();

    expect(mockDb.vacancyApproval.createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects the whole submission when an approverId lacks vacancy:approve', async () => {
    mockDb.user.findMany.mockResolvedValue([
      { id: APPROVER_ID, userRoles: [{ role: { slug: 'committee' } }] },
    ]);
    setApproverAllowed(false);
    const caller = await makeCaller();

    await expect(
      caller.vacancy.submitForApproval({ id: '99999999-9999-4999-8999-999999999999', approverIds: [APPROVER_ID] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mockDb.vacancyApproval.createMany).not.toHaveBeenCalled();
  });

  it('rejects the whole submission when an approverId is inactive/wrong-org/nonexistent', async () => {
    // db.user.findMany filters on organizationId + isActive: true, so a wrong-org or
    // inactive approver simply never appears in the fetched set.
    mockDb.user.findMany.mockResolvedValue([]);
    const caller = await makeCaller();

    await expect(
      caller.vacancy.submitForApproval({ id: '99999999-9999-4999-8999-999999999999', approverIds: [APPROVER_ID] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mockDb.vacancyApproval.createMany).not.toHaveBeenCalled();
  });

  it('rejects the whole submission if ANY of multiple approverIds fails validation', async () => {
    const APPROVER_2 = '22222222-2222-2222-2222-222222222222';
    // Only APPROVER_ID comes back from the DB fetch; APPROVER_2 is missing entirely.
    mockDb.user.findMany.mockResolvedValue([
      { id: APPROVER_ID, userRoles: [{ role: { slug: 'committee' } }] },
    ]);
    const caller = await makeCaller();

    await expect(
      caller.vacancy.submitForApproval({ id: '99999999-9999-4999-8999-999999999999', approverIds: [APPROVER_ID, APPROVER_2] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mockDb.vacancyApproval.createMany).not.toHaveBeenCalled();
  });

  it('rejects the whole submission when an approver holds vacancy:approve but this vacancy is outside their scope', async () => {
    // Codex PR #120 round-3 re-review: model a GENUINELY scope-limited approver
    // (scope: 'team', not the common 'organization' default) to prove the fix
    // probes the approver's own narrower access, not a caller-shaped stub.
    const VACANCY_ID = '99999999-9999-4999-8999-999999999999';
    mockDb.user.findMany.mockResolvedValue([
      { id: APPROVER_ID, userRoles: [{ role: { slug: 'committee' } }] },
    ]);
    setApproverScope('team');
    rejectScopeForUserId(APPROVER_ID);
    const caller = await makeCaller();

    await expect(
      caller.vacancy.submitForApproval({ id: VACANCY_ID, approverIds: [APPROVER_ID] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // The scope probe must run against the APPROVER's own team-scoped access and
    // anchors (keyed to APPROVER_ID, not the submitting caller 'user-1') — proves
    // this isn't the caller's own up-front assertScoped call being reused.
    expect(createAnchorLoaderMock).toHaveBeenCalledWith(ORG_ID, APPROVER_ID);
    expect(assertScopedMock).toHaveBeenCalledWith(
      'vacancy',
      VACANCY_ID,
      expect.objectContaining({ scope: 'team', anchors: { __forUserId: APPROVER_ID } }),
      APPROVER_ID,
      ORG_ID,
    );
    // No approval rows created and no vacancy-status transaction runs — the
    // rejection is a hard stop before any write, not a partial submission.
    expect(mockDb.vacancyApproval.createMany).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});
