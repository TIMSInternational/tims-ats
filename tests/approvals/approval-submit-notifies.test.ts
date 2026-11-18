import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot UX audit B-01: submitForApproval (vacancy and offer) schedules the approver email with
// runAfterResponse, only after the approval chain has committed, and the vacancy approver inbox
// (vacancy.getPending) lists exactly the caller's pending steps.

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ITEM_ID = '99999999-9999-4999-8999-999999999999';
const REQUESTER = '33333333-3333-4333-8333-333333333333';
const APPROVER = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  moved: { count: 1 },
}));

const mockDb = vi.hoisted(() => ({
  offer: { findFirst: vi.fn(), updateMany: vi.fn(), findFirstOrThrow: vi.fn() },
  offerApproval: { createMany: vi.fn() },
  vacancy: { findFirst: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  vacancyApproval: { createMany: vi.fn(), findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: (_org: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['super_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/services/approval-notification.service', () => ({
  approvalNotificationService: { notifyApprovalRequested: mocks.notify },
}));

let scheduled: Array<() => Promise<void>> = [];

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerApprovalsRouter } = await import('../../packages/api/src/routers/offer/approvals');
  const { vacancyApprovalsRouter } = await import('../../packages/api/src/routers/vacancy/approvals');
  return createCallerFactory(router({ offer: offerApprovalsRouter, vacancy: vacancyApprovalsRouter }))({
    user: {
      id: REQUESTER,
      organizationId: ORG_ID,
      roles: ['super_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'admin@acme.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
    runAfterResponse: (task: () => Promise<void>) => scheduled.push(task),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  scheduled = [];
  mocks.notify.mockResolvedValue(undefined);
  mockDb.user.findMany.mockResolvedValue([{ id: APPROVER, userRoles: [{ role: { slug: 'super_admin' } }] }]);
  mockDb.offer.findFirst.mockResolvedValue({ id: ITEM_ID, status: 'draft' });
  mockDb.offer.updateMany.mockImplementation(async () => mocks.moved);
  mockDb.offer.findFirstOrThrow.mockResolvedValue({ id: ITEM_ID, status: 'pending_approval', approvals: [] });
  mockDb.vacancy.findFirst.mockResolvedValue({ id: ITEM_ID });
  mockDb.vacancy.updateMany.mockImplementation(async () => mocks.moved);
  mockDb.vacancy.findUniqueOrThrow.mockResolvedValue({ id: ITEM_ID, status: 'pending_approval', approvals: [] });
  mocks.moved = { count: 1 };
});

describe.each(['offer', 'vacancy'] as const)('%s.submitForApproval notifies the approvers', (kind) => {
  it('schedules the email after the response, with the committed chain', async () => {
    await (await caller())[kind].submitForApproval({ id: ITEM_ID, approverIds: [APPROVER] });

    // Scheduled, not run inline: nothing is sent while the request is still being answered.
    expect(scheduled).toHaveLength(1);
    expect(mocks.notify).not.toHaveBeenCalled();
    await scheduled[0]!();
    expect(mocks.notify).toHaveBeenCalledWith({
      orgId: ORG_ID,
      kind,
      entityId: ITEM_ID,
      approverIds: [APPROVER],
      requesterId: REQUESTER,
    });
  });

  it('schedules nothing when the submission does not commit', async () => {
    mocks.moved = { count: 0 };
    await expect(
      (await caller())[kind].submitForApproval({ id: ITEM_ID, approverIds: [APPROVER] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(scheduled).toHaveLength(0);
  });
});

describe('vacancy.getPending (approver inbox, vacancy half)', () => {
  it("lists only the caller's pending steps on vacancies still pending approval, oldest first", async () => {
    const requestedAt = new Date('2026-11-04T15:00:00Z');
    mockDb.vacancyApproval.findMany.mockResolvedValue([
      {
        id: 'appr-1',
        step: 1,
        createdAt: requestedAt,
        vacancy: { id: ITEM_ID, title: 'Analista', creator: { id: 'u1', firstName: 'Rita', lastName: 'R' } },
      },
    ]);

    const rows = await (await caller()).vacancy.getPending();

    const args = mockDb.vacancyApproval.findMany.mock.calls[0]![0];
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        { organizationId: ORG_ID, approverId: REQUESTER, status: 'pending' },
        { vacancy: { status: 'pending_approval', deletedAt: null } },
      ]),
    );
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    // No silent cap (Codex P2): every pending request is listed, like offer.getPending.
    expect(args.take).toBeUndefined();
    // Explicit projection: no salary, description or other vacancy fields leave the server.
    expect(Object.keys(args.select.vacancy.select).sort()).toEqual(['creator', 'id', 'title']);
    expect(rows).toEqual([
      {
        approvalId: 'appr-1',
        step: 1,
        requestedAt,
        vacancy: { id: ITEM_ID, title: 'Analista', creator: { id: 'u1', firstName: 'Rita', lastName: 'R' } },
      },
    ]);
  });
});
