import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApprovalRaceStore } from '../helpers/approval-race-store';

// Live defect (recruitment-spine characterization, offer 7(b)1): reject flipped only the caller's
// approval row, approve never checked the offer status, and the remaining approver's approve wrote
// status='approved' over the rejection - after which generateSigningLink emailed the candidate.
// These tests run the real offer approvals router against a READ COMMITTED + row-lock model
// (tests/helpers/approval-race-store.ts).
//
// MUTATION CHECK: drop the leading `tx.offer.updateMany(... status: 'pending_approval' ...)` lock
// in approve, or turn the final flip back into an unconditional `update`, and the "rejected stays
// rejected" and "two concurrent final approvals" tests go red.

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OFFER_ID = '99999999-9999-4999-8999-999999999999';
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
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

function seed(status: string, approvals: Array<[string, string]>) {
  holder.store = createApprovalRaceStore({
    parentModel: 'offer',
    approvalModel: 'offerApproval',
    parentKey: 'offerId',
    parent: { id: OFFER_ID, organizationId: ORG_ID, status, deletedAt: null },
    approvals: approvals.map(([approverId, s], i) => ({
      id: `appr-${i + 1}`,
      organizationId: ORG_ID,
      parentId: OFFER_ID,
      approverId,
      status: s,
    })),
  });
}

async function callerFor(userId: string) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerApprovalsRouter } = await import('../../packages/api/src/routers/offer/approvals');
  return createCallerFactory(router({ offer: offerApprovalsRouter }))({
    user: {
      id: userId,
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'approver@acme.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

const statuses = () => store().committed.approvals.map((a) => a.status);

beforeEach(() => {
  seed('pending_approval', [
    [APPROVER_A, 'pending'],
    [APPROVER_B, 'pending'],
  ]);
});

describe('offer approval — state-guarded transitions', () => {
  it('non-vacuity: the last approval moves pending_approval -> approved', async () => {
    await (await callerFor(APPROVER_A)).offer.approve({ id: OFFER_ID });
    expect(store().committed.parent.status).toBe('pending_approval');
    await (await callerFor(APPROVER_B)).offer.approve({ id: OFFER_ID });
    expect(store().committed.parent.status).toBe('approved');
    expect(statuses()).toEqual(['approved', 'approved']);
  });

  it('a rejected offer stays rejected: the remaining approver cannot approve it', async () => {
    await (await callerFor(APPROVER_A)).offer.reject({ id: OFFER_ID, comment: 'salary too high' });
    expect(store().committed.parent.status).toBe('rejected');

    await expect((await callerFor(APPROVER_B)).offer.approve({ id: OFFER_ID })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(store().committed.parent.status).toBe('rejected');
    // B's row is untouched - the whole approve transaction rolled back.
    expect(statuses()).toEqual(['rejected', 'pending']);
  });

  it.each(['draft', 'approved', 'sent', 'accepted', 'declined', 'withdrawn', 'rejected'])(
    'approve and reject refuse an offer in status %s, writing nothing',
    async (status) => {
      seed(status, [[APPROVER_A, 'pending']]);
      await expect((await callerFor(APPROVER_A)).offer.approve({ id: OFFER_ID })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await expect((await callerFor(APPROVER_A)).offer.reject({ id: OFFER_ID, comment: 'no' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(store().committed.parent.status).toBe(status);
      expect(statuses()).toEqual(['pending']);
    },
  );

  it('an approver with no pending row gets NOT_FOUND and the reject rolls back', async () => {
    seed('pending_approval', [
      [APPROVER_A, 'approved'],
      [APPROVER_B, 'pending'],
    ]);
    await expect(
      (await callerFor(APPROVER_A)).offer.reject({ id: OFFER_ID, comment: 'changed my mind' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store().committed.parent.status).toBe('pending_approval');
    expect(statuses()).toEqual(['approved', 'pending']);
  });

  it('two concurrent final approvals: exactly one approved state, never stuck in pending_approval', async () => {
    const [a, b] = await Promise.all([callerFor(APPROVER_A), callerFor(APPROVER_B)]);
    const results = await Promise.allSettled([a.offer.approve({ id: OFFER_ID }), b.offer.approve({ id: OFFER_ID })]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(store().committed.parent.status).toBe('approved');
    expect(statuses()).toEqual(['approved', 'approved']);
  });

  it('concurrent reject + approve: the offer always ends rejected, never approved', async () => {
    const [a, b] = await Promise.all([callerFor(APPROVER_A), callerFor(APPROVER_B)]);
    const results = await Promise.allSettled([
      a.offer.reject({ id: OFFER_ID, comment: 'no' }),
      b.offer.approve({ id: OFFER_ID }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(store().committed.parent.status).toBe('rejected');
    // Either B approved first (its row is approved) or B lost to the reject (CONFLICT, row still pending).
    const bRow = store().committed.approvals[1].status;
    if (results[1].status === 'rejected') expect(bRow).toBe('pending');
    else expect(bRow).toBe('approved');
    expect(store().committed.approvals[0].status).toBe('rejected');
  });
});
