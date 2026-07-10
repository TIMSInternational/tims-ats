import { describe, it, expect, vi, beforeEach } from 'vitest';

// Codex PR #120 finding #5: approve()'s approval-update + pending-count +
// conditional vacancy-status-update sequence must be wrapped in db.$transaction
// (a regression here would silently reopen the finding). Mirrors the mocking
// pattern used in create-autopublish.test.ts / submit-for-approval.test.ts.

const pendingCountAfterApproval = vi.hoisted(() => ({ value: 0 }));
function setPendingCountAfterApproval(value: number) {
  pendingCountAfterApproval.value = value;
}

function mockTx() {
  return {
    vacancyApproval: {
      update: vi.fn().mockResolvedValue({ id: 'appr-1', status: 'approved' }),
      count: vi.fn().mockResolvedValue(pendingCountAfterApproval.value),
    },
    vacancy: {
      update: vi.fn().mockResolvedValue({ id: 'vac-1', status: 'approved' }),
    },
  };
}

const mockDb = vi.hoisted(() => ({
  vacancyApproval: {
    findFirst: vi.fn(),
  },
  vacancy: {
    findUniqueOrThrow: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['committee'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY_ID = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  vi.clearAllMocks();
  setPendingCountAfterApproval(0);
  mockDb.vacancyApproval.findFirst.mockResolvedValue({ id: 'appr-1' });
  mockDb.vacancy.findUniqueOrThrow.mockResolvedValue({
    id: VACANCY_ID, title: 'Sales Rep', status: 'approved', approvals: [],
  });
  mockDb.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)(mockTx())
      : Promise.all(arg as Promise<unknown>[]),
  );
});

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyApprovalsRouter } = await import('../../packages/api/src/routers/vacancy/approvals');
  const testRouter = router({ vacancy: vacancyApprovalsRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'user-1', organizationId: ORG_ID, roles: ['committee'],
      isPlatformOwner: false, impersonatorId: null, email: 'c@tims.co', isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

describe('vacancy.approve — transaction wrapper', () => {
  it('wraps the approval-update + pending-count + vacancy-status-update in db.$transaction, flipping status to approved when the last pending approval clears', async () => {
    setPendingCountAfterApproval(0);
    const caller = await makeCaller();

    const result = await caller.vacancy.approve({ id: VACANCY_ID });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('approved');
  });

  it('still calls $transaction but leaves the vacancy status alone when other approvals remain pending', async () => {
    setPendingCountAfterApproval(1);
    mockDb.vacancy.findUniqueOrThrow.mockResolvedValue({
      id: VACANCY_ID, title: 'Sales Rep', status: 'pending_approval', approvals: [],
    });
    const caller = await makeCaller();

    const result = await caller.vacancy.approve({ id: VACANCY_ID });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('pending_approval');
  });
});
