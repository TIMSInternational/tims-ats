import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OFFER_ID = '22222222-2222-2222-2222-222222222222';
const updatedAt = new Date('2026-09-28T10:00:00Z');
const findOffer = vi.fn();
const updateOffer = vi.fn();
const findOrg = vi.fn();
const sendOffer = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    offer: { findFirst: findOffer, updateMany: updateOffer },
    organization: { findFirst: findOrg },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: { sendOfferToCandidate: sendOffer },
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerSigningRouter } = await import('../../packages/api/src/routers/offer/signing');
  return createCallerFactory(router({ offer: offerSigningRouter }))({
    user: {
      id: '33333333-3333-3333-3333-333333333333',
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@example.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
  findOffer.mockResolvedValue({
    id: OFFER_ID,
    status: 'approved',
    settings: {},
    updatedAt,
    sentAt: null,
    expiresAt: null,
    candidate: { firstName: 'QA', lastName: 'Candidate', email: 'qa@example.test' },
    vacancy: { title: 'QA role' },
  });
  findOrg.mockResolvedValue({ name: 'Example Company' });
  updateOffer.mockResolvedValue({ count: 1 });
  sendOffer.mockResolvedValue(true);
});
afterEach(() => { delete process.env.NEXT_PUBLIC_APP_URL; });

describe('offer signing-link delivery', () => {
  it('returns provider acceptance only after awaiting email send', async () => {
    const result = await (await caller()).offer.generateSigningLink({ offerId: OFFER_ID });
    expect(result.emailDeliveryAccepted).toBe(true);
    expect(result.candidateEmail).toBe('qa@example.test');
    expect(updateOffer).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: OFFER_ID, organizationId: ORG_ID, status: 'approved', updatedAt }),
    }));
    expect(sendOffer).toHaveBeenCalledWith(expect.objectContaining({
      candidateEmail: 'qa@example.test',
      signingUrl: `https://example.test${result.signingUrl}`,
      expiresAt: null,
    }));
  });

  it('reuses an active token on retry and reports unconfirmed delivery', async () => {
    findOffer.mockResolvedValueOnce({
      id: OFFER_ID,
      status: 'sent',
      // Issued to the candidate's current address, so a retry reuses it (recipient-change rotation is
      // covered in signing-token-rotation.test.ts).
      settings: { signingToken: 'stable-token', signingTokenRecipient: 'qa@example.test' },
      updatedAt,
      sentAt: updatedAt,
      expiresAt: null,
      candidate: { firstName: 'QA', lastName: 'Candidate', email: 'qa@example.test' },
      vacancy: { title: 'QA role' },
    });
    sendOffer.mockResolvedValueOnce(false);

    const result = await (await caller()).offer.generateSigningLink({ offerId: OFFER_ID });
    expect(result).toMatchObject({ signingUrl: '/offers/sign/stable-token', emailDeliveryAccepted: false });
    expect(updateOffer).not.toHaveBeenCalled();
  });

  it('does not email a link if the conditional transition lost a race', async () => {
    updateOffer.mockResolvedValueOnce({ count: 0 });
    await expect((await caller()).offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(sendOffer).not.toHaveBeenCalled();
  });

  it('fails before transition if the public app URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    await expect((await caller()).offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(updateOffer).not.toHaveBeenCalled();
    expect(sendOffer).not.toHaveBeenCalled();
  });
});
