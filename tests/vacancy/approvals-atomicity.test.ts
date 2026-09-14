import { describe, it, expect, vi, beforeEach } from 'vitest';

// #45 — atomicity regression test for packages/api/src/routers/vacancy/approvals.ts.
//
// WHY A FAKE STORE INSTEAD OF `expect(x).toHaveBeenCalled()`:
// the defect is not "no transaction was opened", it is "the transaction that was
// opened does not roll anything back". A call-count assertion cannot tell those
// apart. So this file models the two constructs' REAL commit semantics, measured
// on a throwaway PostgreSQL 17 cluster on 2026-08-06 with RLS_ENFORCED=true and a
// prod-shaped tenant_isolation policy:
//
//   tenantDb.$transaction(cb)  -> writes COMMIT AS THEY EXECUTE. After a deliberate
//                                 mid-block throw: status=pending_approval,
//                                 approvals=1 (both writes survived).
//   runTenantTransaction(...)  -> writes are held and discarded on throw. After the
//                                 same throw: status=draft, approvals=0.
//
// Cause: `db` in approvals.ts is `tenantDb`, whose $allOperations extension re-wraps
// every op in its own mini-transaction on the base client (tenant-client.ts:40), so
// an outer tenantDb.$transaction never composes (prisma/prisma#17948).
//
// MUTATION CHECK (run before trusting this file): change any of the three
// `runTenantTransaction(ctx.user.organizationId, async (tx) => {` in approvals.ts
// back to `db.$transaction(async (tx) => {`. Every test below goes red, because the
// $transaction mock applies writes directly to `committed`.

interface Store {
  vacancyStatus: string;
  approvalRows: number;
  pendingApprovals: number;
  cancelledApprovals: number;
}

const committed = vi.hoisted(() => ({ value: null as unknown }) as { value: Store });

// Fails the NEXT call to this tx method, to simulate a mid-block failure.
const failOn = vi.hoisted(() => ({ value: null as string | null }));
function failMidTransactionOn(op: string | null) {
  failOn.value = op;
}

// Builds a tx facade writing into `target`. Passing `committed.value` models the
// broken construct (writes land on committed state immediately); passing a staged
// copy models a real transaction.
function makeTx(target: Store) {
  const guard = async (op: string) => {
    if (failOn.value === op) {
      throw new Error(`DELIBERATE_FAILURE_IN_${op}`);
    }
  };
  return {
    vacancy: {
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        await guard('vacancy.update');
        target.vacancyStatus = data.status;
        return { id: VACANCY_ID, status: data.status };
      }),
      findUniqueOrThrow: vi.fn(async () => ({
        id: VACANCY_ID,
        title: 'Sales Rep',
        status: target.vacancyStatus,
        approvals: [],
      })),
    },
    vacancyApproval: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        await guard('vacancyApproval.createMany');
        target.approvalRows += data.length;
        target.pendingApprovals += data.length;
        return { count: data.length };
      }),
      update: vi.fn(async () => {
        await guard('vacancyApproval.update');
        target.pendingApprovals -= 1;
        return { id: 'appr-1' };
      }),
      updateMany: vi.fn(async () => {
        await guard('vacancyApproval.updateMany');
        target.cancelledApprovals += target.pendingApprovals;
        target.pendingApprovals = 0;
        return { count: 0 };
      }),
      count: vi.fn(async () => target.pendingApprovals),
    },
  };
}

const mockDb = vi.hoisted(() => ({
  vacancy: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  user: { findMany: vi.fn() },
  vacancyApproval: { findFirst: vi.fn() },
  // Models tenantDb.$transaction: NO isolation — each op hits committed state as it
  // runs, exactly as measured on PG17. Present so a mutation back to it fails on an
  // assertion about outcomes, not on a missing mock method.
  $transaction: vi.fn(),
}));

const runTenantTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: runTenantTransactionMock,
}));

vi.mock('@tims/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tims/shared')>()),
  filterStaffRoleSlugs: (slugs: string[]) => slugs,
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['committee'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY_ID = '99999999-9999-4999-8999-999999999999';
const APPROVER_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  failMidTransactionOn(null);
  committed.value = { vacancyStatus: 'draft', approvalRows: 0, pendingApprovals: 0, cancelledApprovals: 0 };

  mockDb.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID });
  mockDb.vacancyApproval.findFirst.mockResolvedValue({ id: 'appr-1' });
  mockDb.user.findMany.mockResolvedValue([{ id: APPROVER_ID, userRoles: [{ role: { slug: 'committee' } }] }]);
  mockDb.vacancy.findUniqueOrThrow.mockImplementation(async () => ({
    id: VACANCY_ID,
    title: 'Sales Rep',
    status: committed.value.vacancyStatus,
    approvals: [],
  }));

  // BROKEN semantics: writes commit as they execute, nothing is rolled back.
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    const tx = makeTx(committed.value);
    return typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)(tx)
      : Promise.all(arg as Promise<unknown>[]);
  });

  // REAL transaction semantics: stage, then commit only on success.
  runTenantTransactionMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
    const staged: Store = { ...committed.value };
    const result = await fn(makeTx(staged)); // a throw here skips the commit below
    committed.value = staged;
    return result;
  });
});

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyApprovalsRouter } = await import('../../packages/api/src/routers/vacancy/approvals');
  const testRouter = router({ vacancy: vacancyApprovalsRouter });
  return createCallerFactory(testRouter)({
    user: {
      id: 'user-1',
      organizationId: ORG_ID,
      roles: ['committee'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'c@tims.co',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('vacancy approvals — multi-step writes are genuinely atomic (#45, prisma#17948)', () => {
  // NON-VACUITY: prove the fixture actually writes on the success path. Without
  // this, the rollback assertions below could pass simply because nothing ever ran.
  it('happy path really does mutate the store (non-vacuity guard for the rollback tests)', async () => {
    const caller = await makeCaller();

    await caller.vacancy.submitForApproval({ id: VACANCY_ID, approverIds: [APPROVER_ID] });

    expect(committed.value.vacancyStatus).toBe('pending_approval');
    expect(committed.value.approvalRows).toBe(1);
  });

  it('submitForApproval rolls the status flip back when the approval-row insert fails mid-transaction', async () => {
    // Write order in the procedure: vacancy.update -> vacancyApproval.createMany.
    // Fail the SECOND write, so the first one is the thing that must not survive.
    failMidTransactionOn('vacancyApproval.createMany');
    const caller = await makeCaller();

    await expect(caller.vacancy.submitForApproval({ id: VACANCY_ID, approverIds: [APPROVER_ID] })).rejects.toThrow();

    // Under tenantDb.$transaction this was pending_approval — a vacancy stuck
    // awaiting approval with nobody assigned to approve it.
    expect(committed.value.vacancyStatus).toBe('draft');
    expect(committed.value.approvalRows).toBe(0);
  });

  it('approve rolls the approval decision back when the vacancy status flip fails mid-transaction', async () => {
    committed.value = {
      vacancyStatus: 'pending_approval',
      approvalRows: 1,
      pendingApprovals: 1,
      cancelledApprovals: 0,
    };
    // Write order: vacancyApproval.update -> count -> (if 0) vacancy.update.
    failMidTransactionOn('vacancy.update');
    const caller = await makeCaller();

    await expect(caller.vacancy.approve({ id: VACANCY_ID })).rejects.toThrow();

    // The approval must NOT stay decided while the vacancy never became approved.
    expect(committed.value.pendingApprovals).toBe(1);
    expect(committed.value.vacancyStatus).toBe('pending_approval');
  });

  it('reject rolls back the status flip when cancelling the remaining pending approvals fails', async () => {
    committed.value = {
      vacancyStatus: 'pending_approval',
      approvalRows: 2,
      pendingApprovals: 2,
      cancelledApprovals: 0,
    };
    // Write order: vacancyApproval.update -> vacancy.update(draft) -> updateMany(cancelled).
    failMidTransactionOn('vacancyApproval.updateMany');
    const caller = await makeCaller();

    await expect(caller.vacancy.reject({ id: VACANCY_ID, comment: 'no' })).rejects.toThrow();

    // The worst old outcome: a `draft` vacancy still carrying live pending approvals.
    expect(committed.value.vacancyStatus).toBe('pending_approval');
    expect(committed.value.cancelledApprovals).toBe(0);
  });

  it('never routes any of the three write blocks through tenantDb.$transaction', async () => {
    const caller = await makeCaller();

    await caller.vacancy.submitForApproval({ id: VACANCY_ID, approverIds: [APPROVER_ID] });
    await caller.vacancy.approve({ id: VACANCY_ID });
    await caller.vacancy.reject({ id: VACANCY_ID, comment: 'no' });

    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(runTenantTransactionMock).toHaveBeenCalledTimes(3);
    // Every call must thread the caller's org id — runTenantTransaction needs it to
    // set the RLS role + app.current_org_id GUC once for the whole transaction.
    for (const call of runTenantTransactionMock.mock.calls) {
      expect(call[0]).toBe(ORG_ID);
    }
  });
});
