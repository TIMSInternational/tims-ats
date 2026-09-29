import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MATRIX, flattenEntries } from '../../packages/db/prisma/seed-access-matrix';

// Access decisions come from the REAL canonical role matrix (seed-access-matrix.ts), so these tests
// prove what the production roles can do — not what a hand-written stub allows.
function decide(roles: string[], module: string, action: string) {
  if (roles.includes('super_admin')) return { allowed: true as const, scope: 'organization', roles };
  const grants = roles
    .flatMap((role) => flattenEntries(MATRIX[role] ?? []))
    .filter((grant) => grant.module === module && grant.action === action);
  return grants.length > 0
    ? { allowed: true as const, scope: grants[0]!.scope, roles }
    : { allowed: false as const, scope: null, roles: null };
}

const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async (user: { roles: string[] }, module: string, action: string) => decide(user.roles, module, action)),
);

const mockDb = vi.hoisted(() => ({
  offer: { findFirst: vi.fn(), update: vi.fn() },
  organization: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  offerApproval: { createMany: vi.fn() },
}));
const runTenantTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  db: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: runTenantTransactionMock,
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: buildAccessForUserMock,
  createAnchorLoader: vi.fn(() => null),
  assertScoped: vi.fn(),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: { sendOfferToCandidate: vi.fn().mockResolvedValue(undefined) },
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OFFER_ID = '99999999-9999-4999-8999-999999999999';
const HR_ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const RECRUITER_ID = '22222222-2222-4222-8222-222222222222';

async function makeCaller(roles: string[]) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerApprovalsRouter } = await import('../../packages/api/src/routers/offer/approvals');
  const { offerSigningRouter } = await import('../../packages/api/src/routers/offer/signing');
  const callerFactory = createCallerFactory(router({ approvals: offerApprovalsRouter, signing: offerSigningRouter }));
  return callerFactory({
    user: {
      id: 'caller-1',
      organizationId: ORG_ID,
      roles,
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'caller@tims.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

function offerWithStatus(status: string) {
  return {
    id: OFFER_ID,
    status,
    settings: {},
    updatedAt: new Date(),
    expiresAt: null,
    sentAt: null,
    candidate: { firstName: 'Ana', lastName: 'Lopez', email: 'ana@candidate.test' },
    vacancy: { title: 'Analyst' },
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN';
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.tims.test';
  mockDb.offer.update.mockResolvedValue({ id: OFFER_ID, status: 'sent', approvals: [], settings: {} });
  mockDb.organization.findFirst.mockResolvedValue({ name: 'Acme' });
  mockDb.offerApproval.createMany.mockResolvedValue({ count: 1 });
  runTenantTransactionMock.mockImplementation(async (_org: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ offer: mockDb.offer, offerApproval: mockDb.offerApproval }),
  );
  mockDb.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    [
      { id: HR_ADMIN_ID, userRoles: [{ role: { slug: 'hr_admin' } }] },
      { id: RECRUITER_ID, userRoles: [{ role: { slug: 'recruiter' } }] },
    ].filter((user) => where.id.in.includes(user.id)),
  );
});

describe('the canonical matrix itself is unchanged (least privilege)', () => {
  it('recruiter still holds offer:create but NOT offer:update — terms stay editable only by HR admins', () => {
    expect(decide(['recruiter'], 'offer', 'create').allowed).toBe(true);
    expect(decide(['recruiter'], 'offer', 'update').allowed).toBe(false);
  });
});

describe('offer.generateSigningLink — recruiter can send an APPROVED offer', () => {
  it('lets a recruiter (offer:create) past the permission gate for an approved offer', async () => {
    mockDb.offer.findFirst.mockResolvedValue(offerWithStatus('approved'));
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).not.toBe('FORBIDDEN');
    expect(mockDb.offer.findFirst).toHaveBeenCalledTimes(1);
  });

  it('still refuses a recruiter a DRAFT offer — the narrow grant covers only the send step', async () => {
    mockDb.offer.findFirst.mockResolvedValue(offerWithStatus('draft'));
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('BAD_REQUEST');
    expect(mockDb.offer.update).not.toHaveBeenCalled();
  });

  it('keeps roles with neither offer:update nor offer:create out (hrbp, employee)', async () => {
    mockDb.offer.findFirst.mockResolvedValue(offerWithStatus('approved'));
    for (const role of ['hrbp', 'employee', 'leader']) {
      const caller = await makeCaller([role]);
      expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('FORBIDDEN');
    }
    expect(mockDb.offer.findFirst).not.toHaveBeenCalled();
  });
});

describe('offer.submitForApproval — recruiter can request approval with a valid approver', () => {
  it('submits a draft to an HR admin who holds offer:approve', async () => {
    mockDb.offer.findFirst.mockResolvedValue(offerWithStatus('draft'));
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [HR_ADMIN_ID] }))).toBeNull();
    expect(mockDb.offerApproval.createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects an approver who cannot approve offers instead of leaving the offer stuck', async () => {
    mockDb.offer.findFirst.mockResolvedValue(offerWithStatus('draft'));
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [RECRUITER_ID] }))).toBe(
      'BAD_REQUEST',
    );
    expect(mockDb.offerApproval.createMany).not.toHaveBeenCalled();
  });

  it('rejects an approver outside the organization / inactive (absent from the scoped lookup)', async () => {
    mockDb.offer.findFirst.mockResolvedValue(offerWithStatus('draft'));
    const caller = await makeCaller(['recruiter']);
    const stranger = '33333333-3333-4333-8333-333333333333';
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [stranger] }))).toBe(
      'BAD_REQUEST',
    );
    const where = mockDb.user.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ organizationId: ORG_ID, isActive: true, deletedAt: null });
  });

  it('still refuses roles with neither offer:update nor offer:create', async () => {
    mockDb.offer.findFirst.mockResolvedValue(offerWithStatus('draft'));
    const caller = await makeCaller(['hrbp']);
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [HR_ADMIN_ID] }))).toBe(
      'FORBIDDEN',
    );
  });
});
