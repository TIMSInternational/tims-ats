import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const CHECK_ID = '22222222-2222-2222-2222-222222222222';
const OFFER_ID = '33333333-3333-3333-3333-333333333333';

const mocks = vi.hoisted(() => ({
  findValidation: vi.fn(),
  updateValidation: vi.fn(),
  findLegalCheck: vi.fn(),
  updateLegalCheck: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    preemploymentValidation: { findFirst: mocks.findValidation, update: mocks.updateValidation },
    legalCheck: { findFirst: mocks.findLegalCheck, update: mocks.updateLegalCheck },
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
  const { offerValidationsRouter } = await import('../../packages/api/src/routers/offer/validations');
  return createCallerFactory(router({ offer: offerValidationsRouter }))({
    user: {
      id: 'hr-1', organizationId: ORG_ID, roles: ['hr_admin'], isPlatformOwner: false,
      impersonatorId: null, email: 'hr@tims.co', isActive: true,
    },
    headers: new Headers(), supabaseAuth: null, externalAuth: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findValidation.mockResolvedValue({ id: CHECK_ID, offerId: OFFER_ID, status: 'pending', offer: { status: 'converted' } });
  mocks.findLegalCheck.mockResolvedValue({ id: CHECK_ID, offerId: OFFER_ID, offer: { status: 'converted' } });
});

describe('converted offer validation history', () => {
  it('rejects changing a pre-employment result after hire conversion', async () => {
    const api = await caller();
    await expect(api.offer.updateValidation({ id: CHECK_ID, status: 'passed' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.updateValidation).not.toHaveBeenCalled();
  });

  it('rejects changing a legal check after hire conversion', async () => {
    const api = await caller();
    await expect(api.offer.updateLegalCheck({ id: CHECK_ID, completed: true }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.updateLegalCheck).not.toHaveBeenCalled();
  });

  it('allows an authorized legal check before conversion', async () => {
    mocks.findLegalCheck.mockResolvedValueOnce({ id: CHECK_ID, offerId: OFFER_ID, offer: { status: 'accepted' } });
    mocks.updateLegalCheck.mockResolvedValueOnce({ id: CHECK_ID, completed: true });
    const api = await caller();

    await api.offer.updateLegalCheck({ id: CHECK_ID, completed: true });

    expect(mocks.updateLegalCheck).toHaveBeenCalledWith({
      where: { id: CHECK_ID },
      data: { completed: true, completedAt: expect.any(Date), completedById: 'hr-1' },
    });
  });
});
