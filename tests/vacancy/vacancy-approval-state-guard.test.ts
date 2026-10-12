import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApprovalRaceStore } from '../helpers/approval-race-store';

// Live defects (recruitment-spine characterization, vacancy 7(b)1 + corrections 3/4):
//  - two concurrent final approvals each counted the other's still-pending row (READ COMMITTED
//    write skew), so neither flipped the vacancy and it stayed in pending_approval forever;
//  - approve never checked status='pending_approval': after a reject (vacancy -> draft, other rows
//    cancelled) or a close, an approve could still move the vacancy to approved.
// The real vacancy approvals router runs against a READ COMMITTED + row-lock model
// (tests/helpers/approval-race-store.ts).

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY_ID = '99999999-9999-4999-8999-999999999999';
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
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['committee'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

function seed(status: string, approvals: Array<[string, string]>) {
  holder.store = createApprovalRaceStore({
    parentModel: 'vacancy',
    approvalModel: 'vacancyApproval',
    parentKey: 'vacancyId',
    parent: { id: VACANCY_ID, organizationId: ORG_ID, status, deletedAt: null },
    approvals: approvals.map(([approverId, s], i) => ({
      id: `appr-${i + 1}`,
      organizationId: ORG_ID,
      parentId: VACANCY_ID,
      approverId,
      status: s,
    })),
  });
}

async function callerFor(userId: string) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyApprovalsRouter } = await import('../../packages/api/src/routers/vacancy/approvals');
  return createCallerFactory(router({ vacancy: vacancyApprovalsRouter }))({
    user: {
      id: userId,
      organizationId: ORG_ID,
      roles: ['committee'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'committee@acme.test',
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

describe('vacancy approval — state-guarded transitions', () => {
  it('non-vacuity: sequential approvals move pending_approval -> approved on the last one', async () => {
    await (await callerFor(APPROVER_A)).vacancy.approve({ id: VACANCY_ID });
    expect(store().committed.parent.status).toBe('pending_approval');
    await (await callerFor(APPROVER_B)).vacancy.approve({ id: VACANCY_ID });
    expect(store().committed.parent.status).toBe('approved');
  });

  it('two simultaneous final approvals: exactly one approved state, never stuck in pending_approval', async () => {
    const [a, b] = await Promise.all([callerFor(APPROVER_A), callerFor(APPROVER_B)]);
    store().overlapNextTransactions(2);
    const results = await Promise.allSettled([
      a.vacancy.approve({ id: VACANCY_ID }),
      b.vacancy.approve({ id: VACANCY_ID }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(store().committed.parent.status).toBe('approved');
    expect(statuses()).toEqual(['approved', 'approved']);
  });

  it('final approval is idempotent: a retry after it committed returns the approved vacancy', async () => {
    seed('pending_approval', [[APPROVER_A, 'pending']]);
    const a = await callerFor(APPROVER_A);
    await a.vacancy.approve({ id: VACANCY_ID });
    const replay = await a.vacancy.approve({ id: VACANCY_ID });
    expect(replay).toMatchObject({ status: 'approved' });
    expect(store().committed.parent.status).toBe('approved');
    expect(statuses()).toEqual(['approved']);
  });

  it('a rejected vacancy cannot become approved: the other approver gets CONFLICT', async () => {
    await (await callerFor(APPROVER_A)).vacancy.reject({ id: VACANCY_ID, comment: 'budget' });
    expect(store().committed.parent.status).toBe('draft');
    expect(statuses()).toEqual(['rejected', 'cancelled']);

    await expect((await callerFor(APPROVER_B)).vacancy.approve({ id: VACANCY_ID })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(store().committed.parent.status).toBe('draft');
    expect(statuses()).toEqual(['rejected', 'cancelled']);
  });

  it('pending rows that survived a close/freeze cannot approve or reject the vacancy', async () => {
    for (const status of ['closed', 'frozen', 'draft', 'published']) {
      seed(status, [[APPROVER_A, 'pending']]);
      const a = await callerFor(APPROVER_A);
      await expect(a.vacancy.approve({ id: VACANCY_ID })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(a.vacancy.reject({ id: VACANCY_ID, comment: 'no' })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(store().committed.parent.status).toBe(status);
      expect(statuses()).toEqual(['pending']);
    }
  });

  it('an approved vacancy cannot be rejected back to draft', async () => {
    seed('approved', [
      [APPROVER_A, 'approved'],
      [APPROVER_B, 'approved'],
    ]);
    await expect(
      (await callerFor(APPROVER_A)).vacancy.reject({ id: VACANCY_ID, comment: 'late' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store().committed.parent.status).toBe('approved');
  });

  it('concurrent reject + approve: the vacancy never ends approved', async () => {
    const [a, b] = await Promise.all([callerFor(APPROVER_A), callerFor(APPROVER_B)]);
    store().overlapNextTransactions(2);
    const results = await Promise.allSettled([
      a.vacancy.reject({ id: VACANCY_ID, comment: 'no' }),
      b.vacancy.approve({ id: VACANCY_ID }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(store().committed.parent.status).toBe('draft');
    expect(statuses()).not.toContain('pending');
  });
});
