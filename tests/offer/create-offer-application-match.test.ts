import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const CANDIDATE_ID = '22222222-2222-2222-2222-222222222222';
const VACANCY_ID = '33333333-3333-3333-3333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-4444-444444444444';

const candidateFindFirst = vi.fn();
const applicationFindFirst = vi.fn();
const offerCreate = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    candidate: { findFirst: candidateFindFirst },
    application: { findFirst: applicationFindFirst },
    offer: { create: offerCreate },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
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
      id: '55555555-5555-5555-5555-555555555555',
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
  offerCreate.mockResolvedValue({ id: 'offer-1', ...input, status: 'draft', settings: {} });
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
    expect(offerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, applicationId: APPLICATION_ID, status: 'draft' }),
    }));
  });
});
