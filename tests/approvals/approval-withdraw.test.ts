import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApprovalRaceStore } from '../helpers/approval-race-store';

// Pilot UX re-audit (company-admin access-1 / journeys-18): a vacancy or offer whose approver is away
// sat in pending_approval forever, because only the named approver could move it. withdrawApproval lets
// whoever may submit it take the request back: the item returns to draft, still-pending steps are
// cancelled, and it can be resubmitted to someone else. These run the real routers against the
// READ COMMITTED + row-lock model in tests/helpers/approval-race-store.ts.
//
// MUTATION CHECK: drop `status: 'pending_approval'` from the withdraw CAS and the "refuses" tests and
// the race in which the approval commits first go red (the withdrawal then overwrites it with draft).

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ITEM_ID = '99999999-9999-4999-8999-999999999999';
const REQUESTER = '33333333-3333-4333-8333-333333333333';
const APPROVER_A = '11111111-1111-4111-8111-111111111111';
const APPROVER_B = '22222222-2222-4222-8222-222222222222';

type Store = ReturnType<typeof createApprovalRaceStore>;
const holder = vi.hoisted(() => ({ store: null as unknown }));
const store = () => holder.store as Store;

vi.mock('@tims/db', () => ({
  tenantDb: new Proxy({}, { get: (_t, model: string) => (store().db as Record<string, unknown>)[model] }),
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: (org: string, fn: (tx: unknown) => Promise<unknown>) => store().runTenantTransaction(org, fn),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['super_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

type Kind = 'offer' | 'vacancy';
// Real UUIDs: decisions and withdrawals carry the step id (`approvalId`), which the input validates.
const stepId = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;

function seed(kind: Kind, status: string, approvals: Array<[string, string]>) {
  holder.store = createApprovalRaceStore({
    parentModel: kind,
    approvalModel: kind === 'offer' ? 'offerApproval' : 'vacancyApproval',
    parentKey: kind === 'offer' ? 'offerId' : 'vacancyId',
    parent: { id: ITEM_ID, organizationId: ORG_ID, status, deletedAt: null },
    approvals: approvals.map(([approverId, s], i) => ({
      id: stepId(i),
      organizationId: ORG_ID,
      parentId: ITEM_ID,
      approverId,
      status: s,
    })),
  });
}

async function callerFor(userId: string) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerApprovalsRouter } = await import('../../packages/api/src/routers/offer/approvals');
  const { vacancyApprovalsRouter } = await import('../../packages/api/src/routers/vacancy/approvals');
  return createCallerFactory(router({ offer: offerApprovalsRouter, vacancy: vacancyApprovalsRouter }))({
    user: {
      id: userId,
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
  } as never);
}

const statuses = () => store().committed.approvals.map((a) => a.status);
// Both name the step the client saw (`approvalId`, required).
const withdrawAs = async (kind: Kind, userId: string, approvalId: string) =>
  (await callerFor(userId))[kind].withdrawApproval({ id: ITEM_ID, approvalId });
const approveAs = async (kind: Kind, userId: string, approvalId: string) =>
  (await callerFor(userId))[kind].approve({ id: ITEM_ID, approvalId });

describe.each<Kind>(['offer', 'vacancy'])('%s.withdrawApproval', (kind) => {
  beforeEach(() => {
    seed(kind, 'pending_approval', [
      [APPROVER_A, 'approved'],
      [APPROVER_B, 'pending'],
    ]);
  });

  it('returns the item to draft, cancels only the still-pending steps, and records who did it', async () => {
    await withdrawAs(kind, REQUESTER, stepId(1));
    expect(store().committed.parent.status).toBe('draft');
    // The decided step keeps its history; the pending one can never be acted on.
    expect(statuses()).toEqual(['approved', 'cancelled']);
    expect(store().committed.audit).toEqual([
      expect.objectContaining({
        organizationId: ORG_ID,
        actorId: REQUESTER,
        action: `${kind}_approval_withdrawn`,
        entity: kind,
        entityId: ITEM_ID,
        metadata: { cancelledSteps: 1 },
      }),
    ]);
  });

  it('leaves nothing the old approver can act on', async () => {
    await withdrawAs(kind, REQUESTER, stepId(1));
    await expect(approveAs(kind, APPROVER_B, stepId(1))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store().committed.parent.status).toBe('draft');
    expect(statuses()).toEqual(['approved', 'cancelled']);
  });

  it.each(['draft', 'approved', 'rejected', 'sent', 'published', 'closed'])(
    'refuses an item in status %s and writes nothing',
    async (status) => {
      seed(kind, status, [[APPROVER_A, 'pending']]);
      await expect(withdrawAs(kind, REQUESTER, stepId(0))).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(store().committed.parent.status).toBe(status);
      expect(statuses()).toEqual(['pending']);
      expect(store().committed.audit).toEqual([]);
    },
  );

  // Two interleavings (with and without the start barrier); whichever side takes the row lock first,
  // the other must see CONFLICT and the committed state must match the winner.
  it.each([true, false])('races a final approval (start barrier: %s): exactly one wins', async (overlap) => {
    seed(kind, 'pending_approval', [[APPROVER_A, 'pending']]);
    if (overlap) store().overlapNextTransactions(2);
    const [approved, withdrawn] = await Promise.allSettled([
      approveAs(kind, APPROVER_A, stepId(0)),
      withdrawAs(kind, REQUESTER, stepId(0)),
    ]);

    const outcomes = [withdrawn.status, approved.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    const loser = withdrawn.status === 'rejected' ? withdrawn : approved;
    expect((loser as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });

    if (withdrawn.status === 'fulfilled') {
      expect(store().committed.parent.status).toBe('draft');
      expect(statuses()).toEqual(['cancelled']);
    } else {
      expect(store().committed.parent.status).toBe('approved');
      expect(statuses()).toEqual(['approved']);
    }
  });

  // Codex (tier 1) P1 on this PR: after withdraw -> edit -> resubmit to the same approver, a decision
  // left open in an old tab must not land on the new request. The client names the step it saw.
  describe('stale tab after withdraw and resubmit', () => {
    beforeEach(() => {
      // Round 1 (cancelled by the withdrawal) and round 2 (the live request), same approver.
      seed(kind, 'pending_approval', [
        [APPROVER_A, 'cancelled'],
        [APPROVER_A, 'pending'],
      ]);
    });

    it('a decision on the withdrawn step is refused and changes nothing', async () => {
      const caller = (await callerFor(APPROVER_A))[kind];
      await expect(caller.approve({ id: ITEM_ID, approvalId: stepId(0) })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(caller.reject({ id: ITEM_ID, approvalId: stepId(0), comment: 'no' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(store().committed.parent.status).toBe('pending_approval');
      expect(statuses()).toEqual(['cancelled', 'pending']);
    });

    it('an unversioned decision (no step id, e.g. a pre-deploy tab) is refused outright', async () => {
      const caller = (await callerFor(APPROVER_A))[kind] as unknown as {
        approve: (input: { id: string }) => Promise<unknown>;
      };
      await expect(caller.approve({ id: ITEM_ID })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(store().committed.parent.status).toBe('pending_approval');
      expect(statuses()).toEqual(['cancelled', 'pending']);
    });

    it('a decision on the live step goes through', async () => {
      await (await callerFor(APPROVER_A))[kind].approve({ id: ITEM_ID, approvalId: stepId(1) });
      expect(store().committed.parent.status).toBe('approved');
      expect(statuses()).toEqual(['cancelled', 'approved']);
    });

    it('a withdrawal from the old request is refused; from the live one it works', async () => {
      const caller = (await callerFor(REQUESTER))[kind];
      await expect(caller.withdrawApproval({ id: ITEM_ID, approvalId: stepId(0) })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(store().committed.parent.status).toBe('pending_approval');
      expect(store().committed.audit).toEqual([]);

      await caller.withdrawApproval({ id: ITEM_ID, approvalId: stepId(1) });
      expect(store().committed.parent.status).toBe('draft');
      expect(statuses()).toEqual(['cancelled', 'cancelled']);
    });
  });
});
