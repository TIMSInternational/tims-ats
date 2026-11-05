import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MATRIX, flattenEntries } from '../../packages/db/prisma/seed-access-matrix';

// Pilot UX audit B-04: offers can be edited while draft (offer.update, offer:create suffices), withdrawn
// (offer.withdraw), at most one open offer exists per candidate and vacancy (offer.create), and the server
// currency default is the organization's (company-admin data-62). Access is decided by the REAL seed matrix.

function decide(roles: string[], module: string, action: string) {
  const grants = roles
    .flatMap((role) => flattenEntries(MATRIX[role] ?? []))
    .filter((grant) => grant.module === module && grant.action === action);
  return grants.length > 0
    ? { allowed: true as const, scope: grants[0]!.scope, roles }
    : { allowed: false as const, scope: null, roles: null };
}

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OFFER_ID = '99999999-9999-4999-8999-999999999999';
const CANDIDATE_ID = '22222222-2222-4222-8222-222222222222';
const VACANCY_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const UPDATED_AT = new Date('2026-11-01T10:00:00.000Z');

const mockDb = vi.hoisted(() => ({
  offer: {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  offerApproval: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  user: { findFirst: vi.fn() },
  candidate: { findFirst: vi.fn() },
  application: { findFirst: vi.fn() },
  organization: { findFirst: vi.fn() },
  vacancy: { findFirst: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: mockDb,
  db: mockDb,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: async (_org: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
}));
vi.mock('../../packages/api/src/access', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildAccessForUser: vi.fn(async (user: { roles: string[] }, module: string, action: string) =>
    decide(user.roles, module, action),
  ),
  assertScoped: vi.fn(async () => undefined),
  scopeWhereFor: vi.fn(async () => ({})),
}));
vi.mock('../../packages/api/src/middleware/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkRateLimit: vi.fn(async () => undefined),
}));

async function caller(roles: string[]) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerRouter } = await import('../../packages/api/src/routers/offer');
  return createCallerFactory(router({ offer: offerRouter }))({
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: ORG_ID,
      roles,
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'staff@tims.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
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
  mockDb.offer.updateMany.mockResolvedValue({ count: 1 });
  mockDb.offer.findFirstOrThrow.mockResolvedValue({ id: OFFER_ID, status: 'draft' });
  mockDb.offerApproval.updateMany.mockResolvedValue({ count: 0 });
  mockDb.user.findFirst.mockResolvedValue({ firstName: 'Rita', lastName: 'Recruiter' });
  mockDb.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
  mockDb.application.findFirst.mockResolvedValue({
    candidateId: CANDIDATE_ID,
    vacancyId: VACANCY_ID,
    status: 'active',
  });
  mockDb.organization.findFirst.mockResolvedValue({ settings: { currency: 'crc' } });
  mockDb.vacancy.findFirst.mockResolvedValue({ company: { currency: 'USD' } });
  mockDb.$queryRaw.mockResolvedValue([{ id: CANDIDATE_ID }]);
  mockDb.offer.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: OFFER_ID,
    ...data,
    settings: {},
  }));
});

describe('offer.update — "Editar borrador"', () => {
  it('lets a recruiter (offer:create, no offer:update) edit a DRAFT, as a compare-and-set on draft', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce({ id: OFFER_ID, status: 'draft' });
    await (await caller(['recruiter'])).offer.update({ id: OFFER_ID, salary: 12_000_000, contractType: 'Plazo fijo' });
    expect(mockDb.offer.updateMany).toHaveBeenCalledWith({
      where: { id: OFFER_ID, organizationId: ORG_ID, status: 'draft' },
      data: { salary: 12_000_000, contractType: 'Plazo fijo' },
    });
  });

  it('never returns settings (the signing token lives there)', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce({ id: OFFER_ID, status: 'draft' });
    await (await caller(['recruiter'])).offer.update({ id: OFFER_ID, salary: 12_000_000 });
    const { select } = mockDb.offer.findFirstOrThrow.mock.calls[0]![0] as { select: Record<string, boolean> };
    expect(select.settings).toBeUndefined();
  });

  it.each(['pending_approval', 'approved', 'sent', 'accepted'])('refuses to edit a %s offer', async (status) => {
    mockDb.offer.findFirst.mockResolvedValueOnce({ id: OFFER_ID, status });
    expect(await codeOf((await caller(['recruiter'])).offer.update({ id: OFFER_ID, salary: 1 }))).toBe('BAD_REQUEST');
    expect(mockDb.offer.updateMany).not.toHaveBeenCalled();
  });

  it('conflicts when the draft was submitted for approval between the check and the write', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce({ id: OFFER_ID, status: 'draft' });
    mockDb.offer.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await codeOf((await caller(['recruiter'])).offer.update({ id: OFFER_ID, salary: 1 }))).toBe('CONFLICT');
  });

  it('keeps roles with neither offer:create nor offer:update out (leader, employee)', async () => {
    for (const role of ['leader', 'employee']) {
      expect(await codeOf((await caller([role])).offer.update({ id: OFFER_ID, salary: 1 }))).toBe('FORBIDDEN');
    }
    expect(mockDb.offer.updateMany).not.toHaveBeenCalled();
  });
});

describe('offer.withdraw — "Retirar oferta"', () => {
  const sentOffer = {
    id: OFFER_ID,
    status: 'sent',
    updatedAt: UPDATED_AT,
    settings: { signingToken: 'live-token', signingTokenRecipient: 'ana@candidate.test', note: 'kept' },
  };

  it('withdraws a sent offer: drops the signing token, records who/why, cancels pending steps, audits', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce(sentOffer);
    mockDb.offerApproval.updateMany.mockResolvedValueOnce({ count: 0 });
    await (await caller(['recruiter'])).offer.withdraw({ id: OFFER_ID, reason: '  Error en el salario  ' });

    const { where, data } = mockDb.offer.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: { status: string; settings: Record<string, unknown> };
    };
    expect(where).toEqual({ id: OFFER_ID, organizationId: ORG_ID, status: 'sent', updatedAt: UPDATED_AT });
    expect(data.status).toBe('withdrawn');
    expect(data.settings.signingToken).toBeUndefined();
    expect(data.settings.signingTokenRecipient).toBeUndefined();
    expect(data.settings).toMatchObject({
      note: 'kept',
      withdrawnByName: 'Rita Recruiter',
      withdrawnReason: 'Error en el salario',
    });
    expect(typeof data.settings.withdrawnAt).toBe('string');
    expect(mockDb.offerApproval.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, offerId: OFFER_ID, status: 'pending' },
      data: { status: 'cancelled' },
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'offer_withdrawn', entityId: OFFER_ID }) }),
    );
  });

  it.each(['accepted', 'converted', 'declined', 'rejected', 'withdrawn'])(
    'refuses to withdraw a %s offer',
    async (status) => {
      mockDb.offer.findFirst.mockResolvedValueOnce({ ...sentOffer, status });
      expect(await codeOf((await caller(['recruiter'])).offer.withdraw({ id: OFFER_ID }))).toBe('BAD_REQUEST');
      expect(mockDb.offer.updateMany).not.toHaveBeenCalled();
    },
  );

  it('conflicts when the candidate answered (or the offer moved) first', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce(sentOffer);
    mockDb.offer.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await codeOf((await caller(['recruiter'])).offer.withdraw({ id: OFFER_ID }))).toBe('CONFLICT');
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('keeps roles that cannot send offers for approval out (leader)', async () => {
    expect(await codeOf((await caller(['leader'])).offer.withdraw({ id: OFFER_ID }))).toBe('FORBIDDEN');
  });

  it('bounds the reason', async () => {
    expect(await codeOf((await caller(['recruiter'])).offer.withdraw({ id: OFFER_ID, reason: 'x'.repeat(501) }))).toBe(
      'BAD_REQUEST',
    );
  });
});

describe('offer.create — one open offer per candidate and vacancy, organization currency', () => {
  const input = {
    candidateId: CANDIDATE_ID,
    vacancyId: VACANCY_ID,
    applicationId: APPLICATION_ID,
    salary: 12_000_000,
    startDate: new Date('2026-12-01T12:00:00Z'),
    contractType: 'Plazo indefinido',
  };

  it('refuses a second offer while one is open, after locking the candidate row', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce({ id: 'existing-offer' });
    expect(await codeOf((await caller(['recruiter'])).offer.create(input))).toBe('CONFLICT');
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockDb.offer.create).not.toHaveBeenCalled();
    // An expired sent offer does not count; rejected, declined and withdrawn ones are not in the filter.
    const { where } = mockDb.offer.findFirst.mock.calls[0]![0] as { where: { OR: unknown[] } };
    expect(where).toMatchObject({ organizationId: ORG_ID, candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID });
    expect(JSON.stringify(where.OR)).not.toMatch(/rejected|declined|withdrawn/);
  });

  it('creates when no open offer exists, defaulting the currency to the organization one', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce(null);
    await (await caller(['recruiter'])).offer.create(input);
    expect(mockDb.offer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'CRC', status: 'draft' }) }),
    );
  });

  it("falls back to the vacancy company's currency, then USD", async () => {
    mockDb.offer.findFirst.mockResolvedValue(null);
    mockDb.organization.findFirst.mockResolvedValueOnce({ settings: {} });
    mockDb.vacancy.findFirst.mockResolvedValueOnce({ company: null });
    await (await caller(['recruiter'])).offer.create(input);
    expect(mockDb.offer.create.mock.calls[0]![0]).toMatchObject({ data: { currency: 'USD' } });

    mockDb.organization.findFirst.mockResolvedValueOnce({ settings: { currency: 'pesos' } });
    mockDb.vacancy.findFirst.mockResolvedValueOnce({ company: { currency: 'gtq' } });
    await (await caller(['recruiter'])).offer.create(input);
    expect(mockDb.offer.create.mock.calls[1]![0]).toMatchObject({ data: { currency: 'GTQ' } });
  });

  it('keeps an explicit currency', async () => {
    mockDb.offer.findFirst.mockResolvedValueOnce(null);
    await (await caller(['recruiter'])).offer.create({ ...input, currency: 'usd' });
    expect(mockDb.organization.findFirst).not.toHaveBeenCalled();
    expect(mockDb.offer.create.mock.calls[0]![0]).toMatchObject({ data: { currency: 'USD' } });
  });
});
