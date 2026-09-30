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
  offer: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  organization: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  offerApproval: { createMany: vi.fn(), findFirst: vi.fn() },
}));
const runTenantTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  db: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: runTenantTransactionMock,
}));

// Teams each user LEADS. The offer under test hangs off a vacancy on OFFER_TEAM_ID, so only a leader of
// that team holds it in (team-scoped) offer:approve scope.
const OFFER_TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TEAM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LED_TEAMS = vi.hoisted(() => new Map<string, string[]>());

// The REAL assertScoped + scopeWhereFor run (so the approver probe really builds the leader's team
// fragment); only the anchor loader and the grant lookup are stubbed.
vi.mock('../../packages/api/src/access', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildAccessForUser: buildAccessForUserMock,
  createAnchorLoader: vi.fn((_orgId: string, userId: string) => ({
    ledTeamIds: async () => LED_TEAMS.get(userId) ?? [],
    unitIds: async () => [],
    teamMemberIds: async () => [userId],
    unitMemberIds: async () => [],
  })),
}));

// `generateSigningLink` matches the AI rate-limit tier ("generate"), which is keyed per ORGANIZATION at
// 10/min — this file sends more than that from one org, so the limiter is neutralised here.
vi.mock('../../packages/api/src/middleware/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkRateLimit: vi.fn(async () => undefined),
}));

const sendOfferToCandidateMock = vi.hoisted(() => vi.fn());
vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: { sendOfferToCandidate: sendOfferToCandidateMock },
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OFFER_ID = '99999999-9999-4999-8999-999999999999';
const HR_ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const RECRUITER_ID = '22222222-2222-4222-8222-222222222222';
const LEADER_IN_SCOPE_ID = '44444444-4444-4444-8444-444444444444';
const LEADER_OTHER_TEAM_ID = '55555555-5555-4555-8555-555555555555';

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

// The candidate row was last edited BEFORE the offer entered the approval chain (the normal case).
const CANDIDATE_EDITED_AT = new Date('2026-09-01T10:00:00.000Z');
const SUBMITTED_AT = new Date('2026-09-02T10:00:00.000Z');
const CANDIDATE = vi.hoisted(() => ({ email: 'ana@candidate.test', updatedAt: new Date(0) }));

function offerWithStatus(status: string) {
  return {
    id: OFFER_ID,
    status,
    settings: {},
    updatedAt: new Date(),
    expiresAt: null,
    sentAt: null,
    candidate: { firstName: 'Ana', lastName: 'Lopez', email: CANDIDATE.email, updatedAt: CANDIDATE.updatedAt },
    vacancy: { title: 'Analyst' },
  };
}

// Every `teamId: { in: [...] }` list inside a Prisma where (the team-scope vacancy anchor).
function teamIdLists(node: unknown): string[][] {
  if (Array.isArray(node)) return node.flatMap(teamIdLists);
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => {
    const inList = (value as { in?: unknown } | null)?.in;
    if (key === 'teamId' && Array.isArray(inList)) return [inList as string[]];
    return teamIdLists(value);
  });
}

// The offer's vacancy sits on OFFER_TEAM_ID and is assigned to nobody under test, so a team-scoped
// where matches it only when the leader's led teams include OFFER_TEAM_ID.
function useOffer(status: string, settings: Record<string, unknown> = {}) {
  mockDb.offer.findFirst.mockImplementation(async ({ where }: { where: unknown }) => {
    const lists = teamIdLists(where);
    if (lists.length > 0 && !lists.some((ids) => ids.includes(OFFER_TEAM_ID))) return null;
    return { ...offerWithStatus(status), settings };
  });
}

const SIGN_URL = /^https:\/\/app\.tims\.test\/offers\/sign\/([0-9a-f-]{36})$/;

/** The bearer token the candidate email carried (the only place a recruiter's send may put it). */
function emailedToken(): string {
  const { signingUrl } = sendOfferToCandidateMock.mock.calls[0]![0] as { signingUrl: string };
  const match = SIGN_URL.exec(signingUrl);
  expect(match).not.toBeNull();
  return match![1]!;
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
  mockDb.offer.update.mockResolvedValue({ id: OFFER_ID, status: 'pending_approval', approvals: [], settings: {} });
  mockDb.offer.updateMany.mockResolvedValue({ count: 1 });
  sendOfferToCandidateMock.mockResolvedValue(true);
  LED_TEAMS.clear();
  LED_TEAMS.set(LEADER_IN_SCOPE_ID, [OFFER_TEAM_ID]);
  LED_TEAMS.set(LEADER_OTHER_TEAM_ID, [OTHER_TEAM_ID]);
  mockDb.organization.findFirst.mockResolvedValue({ name: 'Acme' });
  mockDb.offerApproval.createMany.mockResolvedValue({ count: 1 });
  CANDIDATE.email = 'ana@candidate.test';
  CANDIDATE.updatedAt = CANDIDATE_EDITED_AT;
  mockDb.offerApproval.findFirst.mockResolvedValue({ createdAt: SUBMITTED_AT });
  runTenantTransactionMock.mockImplementation(async (_org: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ offer: mockDb.offer, offerApproval: mockDb.offerApproval }),
  );
  mockDb.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    [
      { id: HR_ADMIN_ID, userRoles: [{ role: { slug: 'hr_admin' } }] },
      { id: RECRUITER_ID, userRoles: [{ role: { slug: 'recruiter' } }] },
      { id: LEADER_IN_SCOPE_ID, userRoles: [{ role: { slug: 'leader' } }] },
      { id: LEADER_OTHER_TEAM_ID, userRoles: [{ role: { slug: 'leader' } }] },
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
  it('lets a recruiter (offer:create) send an approved offer: status flips to sent and the email goes out', async () => {
    useOffer('approved');
    const caller = await makeCaller(['recruiter']);
    const result = await caller.signing.generateSigningLink({ offerId: OFFER_ID });

    expect(result.emailDeliveryAccepted).toBe(true);
    expect(result.candidateEmail).toBe('ana@candidate.test');
    // Codex #304 round 2: the URL is the candidate's bearer token — a recruiter never gets it back.
    expect(result.signingUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain(emailedToken());
    // The optimistic approved -> sent transition, guarded on the status it read.
    expect(mockDb.offer.updateMany).toHaveBeenCalledTimes(1);
    const transition = mockDb.offer.updateMany.mock.calls[0]![0];
    expect(transition.where).toMatchObject({ id: OFFER_ID, organizationId: ORG_ID, status: 'approved' });
    expect(transition.data).toMatchObject({ status: 'sent' });
    expect(sendOfferToCandidateMock).toHaveBeenCalledTimes(1);
    expect(sendOfferToCandidateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateEmail: 'ana@candidate.test',
        companyName: 'Acme',
        signingUrl: expect.stringMatching(SIGN_URL),
      }),
    );
  });

  it('refuses a recruiter (offer:create only) re-sending an already-SENT offer: that re-emails the LIVE token', async () => {
    const existing = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    useOffer('sent', { signingToken: existing });
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('FORBIDDEN');
    expect(mockDb.offer.updateMany).not.toHaveBeenCalled();
    expect(sendOfferToCandidateMock).not.toHaveBeenCalled();
  });

  // #304 panel (HIGH): recruiters hold candidate:update org-wide (candidate/crud.ts update), so they can point
  // candidate.email at an address they control. The send path must not deliver the bearer link there.
  it('email-redirect: a recruiter who edits the candidate email after an offer was SENT cannot re-send the live token to it', async () => {
    const existing = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    CANDIDATE.email = 'attacker@recruiter.test';
    CANDIDATE.updatedAt = new Date('2026-09-03T10:00:00.000Z');
    useOffer('sent', { signingToken: existing });
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('FORBIDDEN');
    expect(sendOfferToCandidateMock).not.toHaveBeenCalled();
  });

  it('email-redirect: a recruiter cannot send an APPROVED offer after the candidate row changed post-submission', async () => {
    CANDIDATE.email = 'attacker@recruiter.test';
    CANDIDATE.updatedAt = new Date('2026-09-03T10:00:00.000Z'); // after SUBMITTED_AT
    useOffer('approved');
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('FORBIDDEN');
    expect(mockDb.offer.updateMany).not.toHaveBeenCalled();
    expect(sendOfferToCandidateMock).not.toHaveBeenCalled();
    // The anchor is the LATEST submission of THIS offer in THIS organization.
    expect(mockDb.offerApproval.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { offerId: OFFER_ID, organizationId: ORG_ID },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('refuses a recruiter an approved offer with no approval chain to anchor the address on (fail closed)', async () => {
    mockDb.offerApproval.findFirst.mockResolvedValue(null);
    useOffer('approved');
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('FORBIDDEN');
    expect(sendOfferToCandidateMock).not.toHaveBeenCalled();
  });

  it('an HR admin (offer:update) can still send after a candidate edit — the guard binds only the offer:create widening', async () => {
    CANDIDATE.updatedAt = new Date('2026-09-03T10:00:00.000Z');
    useOffer('approved');
    const caller = await makeCaller(['hr_admin']);
    const result = await caller.signing.generateSigningLink({ offerId: OFFER_ID });
    expect(result.signingUrl).toMatch(/^\/offers\/sign\//);
    expect(sendOfferToCandidateMock).toHaveBeenCalledTimes(1);
    expect(mockDb.offerApproval.findFirst).not.toHaveBeenCalled();
  });

  it('still returns the signing link to an HR admin (offer:update), as before the widening', async () => {
    const existing = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    useOffer('sent', { signingToken: existing });
    const caller = await makeCaller(['hr_admin']);
    const result = await caller.signing.generateSigningLink({ offerId: OFFER_ID });
    expect(result.signingUrl).toBe(`/offers/sign/${existing}`);
  });

  it('still refuses a recruiter a DRAFT offer — the narrow grant covers only the send step', async () => {
    useOffer('draft');
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('BAD_REQUEST');
    expect(mockDb.offer.updateMany).not.toHaveBeenCalled();
    expect(sendOfferToCandidateMock).not.toHaveBeenCalled();
  });

  it('keeps roles with neither offer:update nor offer:create out (hrbp, employee)', async () => {
    useOffer('approved');
    for (const role of ['hrbp', 'employee', 'leader']) {
      const caller = await makeCaller([role]);
      expect(await codeOf(caller.signing.generateSigningLink({ offerId: OFFER_ID }))).toBe('FORBIDDEN');
    }
    expect(mockDb.offer.findFirst).not.toHaveBeenCalled();
  });
});

describe('offer.submitForApproval — recruiter can request approval with a valid approver', () => {
  it('submits a draft to an HR admin who holds offer:approve', async () => {
    useOffer('draft');
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [HR_ADMIN_ID] }))).toBeNull();
    expect(mockDb.offerApproval.createMany).toHaveBeenCalledTimes(1);
  });

  it('accepts a leader whose team owns the offer (team-scoped offer:approve covers it)', async () => {
    useOffer('draft');
    const caller = await makeCaller(['recruiter']);
    expect(
      await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [LEADER_IN_SCOPE_ID] })),
    ).toBeNull();
    expect(mockDb.offerApproval.createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a leader from an unrelated team: approve() would 404 them, so the offer would be stuck', async () => {
    useOffer('draft');
    const caller = await makeCaller(['recruiter']);
    let error: unknown = null;
    try {
      await caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [HR_ADMIN_ID, LEADER_OTHER_TEAM_ID] });
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Uno o mas aprobadores no tienen esta oferta dentro de su alcance',
    });
    expect(mockDb.offerApproval.createMany).not.toHaveBeenCalled();
    expect(mockDb.offer.update).not.toHaveBeenCalled();
  });

  it('rejects an approver who cannot approve offers instead of leaving the offer stuck', async () => {
    useOffer('draft');
    const caller = await makeCaller(['recruiter']);
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [RECRUITER_ID] }))).toBe(
      'BAD_REQUEST',
    );
    expect(mockDb.offerApproval.createMany).not.toHaveBeenCalled();
  });

  it('rejects an approver outside the organization / inactive (absent from the scoped lookup)', async () => {
    useOffer('draft');
    const caller = await makeCaller(['recruiter']);
    const stranger = '33333333-3333-4333-8333-333333333333';
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [stranger] }))).toBe(
      'BAD_REQUEST',
    );
    const where = mockDb.user.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ organizationId: ORG_ID, isActive: true, deletedAt: null });
  });

  it('still refuses roles with neither offer:update nor offer:create', async () => {
    useOffer('draft');
    const caller = await makeCaller(['hrbp']);
    expect(await codeOf(caller.approvals.submitForApproval({ id: OFFER_ID, approverIds: [HR_ADMIN_ID] }))).toBe(
      'FORBIDDEN',
    );
  });
});
