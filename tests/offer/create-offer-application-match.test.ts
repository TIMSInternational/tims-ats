import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_ID = '22222222-2222-4222-8222-222222222222';
const VACANCY_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

const candidateFindFirst = vi.fn();
const applicationFindFirst = vi.fn();
const applicationFindMany = vi.fn();
const offerCreate = vi.fn();
const offerFindFirst = vi.fn();
const offerUpdate = vi.fn();
const offerUpdateMany = vi.fn();
const offerFindFirstOrThrow = vi.fn();
// offer.create locks the candidate row inside its transaction (one open offer per candidate + vacancy).
const queryRaw = vi.fn();

vi.mock('@tims/db', () => {
  const tenantDb = {
    candidate: { findFirst: candidateFindFirst },
    application: { findFirst: applicationFindFirst, findMany: applicationFindMany },
    offer: {
      create: offerCreate,
      findFirst: offerFindFirst,
      update: offerUpdate,
      updateMany: offerUpdateMany,
      findFirstOrThrow: offerFindFirstOrThrow,
    },
    organization: { findFirst: vi.fn(async () => ({ settings: {} })) },
    vacancy: { findFirst: vi.fn(async () => ({ company: null })) },
    $queryRaw: queryRaw,
  };
  return {
    tenantDb,
    runWithTenant: (_org: string, fn: () => unknown) => fn(),
    runTenantTransaction: async (_org: string, fn: (tx: unknown) => Promise<unknown>) => fn(tenantDb),
  };
});
// This file makes more mutations than the in-memory per-user limit allows in a minute; the limiter is not under test.
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerCrudRouter } = await import('../../packages/api/src/routers/offer/crud');
  return createCallerFactory(router({ offer: offerCrudRouter }))({
    user: {
      id: '55555555-5555-4555-8555-555555555555',
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@example.com',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

const input = {
  candidateId: CANDIDATE_ID,
  vacancyId: VACANCY_ID,
  applicationId: APPLICATION_ID,
  salary: 50000000,
  currency: 'COP',
  startDate: new Date('2026-10-15T12:00:00Z'),
  contractType: 'Contrato de prueba',
};

beforeEach(() => {
  vi.clearAllMocks();
  candidateFindFirst.mockResolvedValue({ id: CANDIDATE_ID });
  applicationFindFirst.mockResolvedValue({ candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, status: 'active' });
  applicationFindMany.mockResolvedValue([]);
  offerCreate.mockResolvedValue({ id: 'offer-1', ...input, status: 'draft', settings: {} });
  offerFindFirst.mockResolvedValue(null);
  queryRaw.mockResolvedValue([{ id: CANDIDATE_ID }]);
  offerUpdateMany.mockResolvedValue({ count: 1 });
  offerFindFirstOrThrow.mockResolvedValue({ id: 'offer-1', status: 'draft' });
});

describe('offer creation application integrity', () => {
  it.each([
    { candidateId: 'other', vacancyId: VACANCY_ID, status: 'active' },
    { candidateId: CANDIDATE_ID, vacancyId: 'other', status: 'active' },
    { candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, status: 'rejected' },
  ])('rejects an application not matching an active candidate-vacancy pair: %j', async (application) => {
    applicationFindFirst.mockResolvedValue(application);
    await expect((await caller()).offer.create(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(offerCreate).not.toHaveBeenCalled();
  });

  it('creates a draft for a matching active application', async () => {
    await (await caller()).offer.create(input);
    expect(offerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateId: CANDIDATE_ID,
          vacancyId: VACANCY_ID,
          applicationId: APPLICATION_ID,
          status: 'draft',
        }),
      }),
    );
  });

  it('normalizes the currency to a trimmed upper-case ISO code', async () => {
    await (await caller()).offer.create({ ...input, currency: ' cop ' });
    expect(offerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currency: 'COP' }),
      }),
    );
  });

  // Codex review of release/pilot-ux-wave2 (P1): after the candidate withdrew (C-33), an offer WITHOUT the
  // application link must not re-open the process.
  it('refuses an unlinked offer when the candidate withdrew and has no other open application for the vacancy', async () => {
    const { WITHDRAWN_APPLICATION_MESSAGE } = await import('../../packages/api/src/routers/offer/rejected-application-guard');
    applicationFindMany.mockResolvedValue([{ status: 'withdrawn' }]);
    const { applicationId: _omit, ...unlinked } = input;
    await expect((await caller()).offer.create(unlinked)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: WITHDRAWN_APPLICATION_MESSAGE,
    });
    expect(applicationFindMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID },
      select: { status: true },
    });
    expect(offerCreate).not.toHaveBeenCalled();
  });

  it.each([[[]], [[{ status: 'active' }]], [[{ status: 'withdrawn' }, { status: 'active' }]], [[{ status: 'rejected' }]]])(
    'still creates an unlinked draft when the applications are %j (open, absent, or only rejected as before)',
    async (applications) => {
      applicationFindMany.mockResolvedValue(applications);
      const { applicationId: _omit, ...unlinked } = input;
      await (await caller()).offer.create(unlinked);
      expect(offerCreate).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['COP$', 'PESOS', 'CO', ''])('rejects a non-ISO currency %j before writing', async (currency) => {
    await expect((await caller()).offer.create({ ...input, currency })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(offerCreate).not.toHaveBeenCalled();
  });
});

describe('offer salary bounds', () => {
  const OFFER_ID = '66666666-6666-4666-8666-666666666666';

  it.each([Infinity, -Infinity, Number.NaN, 1e300, 1_000_000_000_001, 0, -5])(
    'create rejects a non-finite, out-of-range or non-positive salary %s before writing',
    async (salary) => {
      await expect((await caller()).offer.create({ ...input, salary })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(offerCreate).not.toHaveBeenCalled();
    },
  );

  it('create accepts a salary exactly at the cap', async () => {
    await (await caller()).offer.create({ ...input, salary: 1_000_000_000_000 });
    expect(offerCreate).toHaveBeenCalledTimes(1);
  });

  it.each([Infinity, 1e300, 1_000_000_000_001])(
    'update rejects salary %s before reading or writing',
    async (salary) => {
      await expect((await caller()).offer.update({ id: OFFER_ID, salary })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(offerFindFirst).not.toHaveBeenCalled();
      expect(offerUpdate).not.toHaveBeenCalled();
      expect(offerUpdateMany).not.toHaveBeenCalled();
    },
  );

  it('update accepts an in-range salary on a draft (compare-and-set on draft)', async () => {
    offerFindFirst.mockResolvedValue({ id: OFFER_ID, status: 'draft' });
    await (await caller()).offer.update({ id: OFFER_ID, salary: 96_000_000 });
    expect(offerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: OFFER_ID, organizationId: ORG_ID, status: 'draft' }),
        data: expect.objectContaining({ salary: 96_000_000 }),
      }),
    );
  });

  // Pilot call audit 2026-11-05: a zero-decimal currency (CRC, COP…) stores whole amounts (crud.ts wholeIfZeroDecimal).
  it('create rounds a zero-decimal salary and keeps the cents of any other currency', async () => {
    await (await caller()).offer.create({ ...input, currency: 'CRC', salary: 12_000_000.12 });
    expect(offerCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ salary: 12_000_000, currency: 'CRC' }) }),
    );
    await (await caller()).offer.create({ ...input, currency: 'USD', salary: 4_500.5 });
    expect(offerCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ salary: 4_500.5, currency: 'USD' }) }),
    );
  });

  it.each([
    { label: 'the sent currency', stored: 'USD', sent: 'CRC' as string | undefined, salary: 12_000_000.12, saved: 12_000_000 },
    { label: 'the stored currency when none is sent', stored: 'CRC', sent: undefined, salary: 12_000_000.12, saved: 12_000_000 },
    { label: 'a currency with cents', stored: 'CRC', sent: 'USD', salary: 4_500.5, saved: 4_500.5 },
  ])('update rounds a zero-decimal salary by $label', async ({ stored, sent, salary, saved }) => {
    offerFindFirst.mockResolvedValue({ id: OFFER_ID, status: 'draft', currency: stored });
    await (await caller()).offer.update({ id: OFFER_ID, salary, ...(sent && { currency: sent }) });
    expect(offerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ salary: saved }) }),
    );
  });
});
