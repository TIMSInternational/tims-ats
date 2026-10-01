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
// Many calls from one caller in this file — keep the per-user mutation limiter out of the way.
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
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
afterEach(() => { delete process.env.NEXT_PUBLIC_APP_URL; vi.unstubAllEnvs(); });

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

// #322: the negative paths. Every refusal must happen BEFORE the token transition and the send, so
// a refused request neither activates a bearer link nor emails one.
function expectNothingSent() {
  expect(updateOffer).not.toHaveBeenCalled();
  expect(sendOffer).not.toHaveBeenCalled();
}
const baseOffer = () => ({
  id: OFFER_ID,
  status: 'approved',
  settings: {},
  updatedAt,
  sentAt: null,
  expiresAt: null,
  candidate: { firstName: 'QA', lastName: 'Candidate', email: 'qa@example.test' },
  vacancy: { title: 'QA role' },
});

describe('offer signing-link delivery — negative paths (#322)', () => {
  it('refuses when the candidate has no email', async () => {
    findOffer.mockResolvedValueOnce({ ...baseOffer(), candidate: { firstName: 'QA', lastName: 'Candidate', email: null } });
    await expect((await caller()).offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expectNothingSent();
  });

  it('refuses an expired offer', async () => {
    findOffer.mockResolvedValueOnce({ ...baseOffer(), expiresAt: new Date(Date.now() - 60_000) });
    await expect((await caller()).offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expectNothingSent();
  });

  it('refuses when the organization is not found', async () => {
    findOrg.mockResolvedValueOnce(null);
    await expect((await caller()).offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expectNothingSent();
  });

  it.each(['not a url', 'ftp://example.test', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'refuses an invalid or non-HTTP public app URL (%s)',
    async (url) => {
      process.env.NEXT_PUBLIC_APP_URL = url;
      await expect((await caller()).offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
      });
      expectNothingSent();
    },
  );

  it('refuses a plain-http public app URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXT_PUBLIC_APP_URL = 'http://ats.example.test';
    await expect((await caller()).offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expectNothingSent();
  });

  it('accepts https in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await (await caller()).offer.generateSigningLink({ offerId: OFFER_ID });
    expect(sendOffer).toHaveBeenCalledWith(expect.objectContaining({
      signingUrl: `https://example.test${result.signingUrl}`,
    }));
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])(
    'tolerates a loopback http URL in production (local `next start`): %s',
    async (url) => {
      vi.stubEnv('NODE_ENV', 'production');
      process.env.NEXT_PUBLIC_APP_URL = url;
      await (await caller()).offer.generateSigningLink({ offerId: OFFER_ID });
      expect(sendOffer).toHaveBeenCalledWith(expect.objectContaining({ signingUrl: expect.stringMatching(/^http:\/\/(localhost|127\.0\.0\.1):3000\/offers\/sign\//) }));
    },
  );

  it('tolerates plain http outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.NEXT_PUBLIC_APP_URL = 'http://ats.example.test';
    await (await caller()).offer.generateSigningLink({ offerId: OFFER_ID });
    expect(sendOffer).toHaveBeenCalledTimes(1);
  });

  it('a SENT offer with no stored token mints a fresh token through the compare-and-set (never emails "undefined")', async () => {
    findOffer.mockResolvedValueOnce({ ...baseOffer(), status: 'sent', sentAt: updatedAt, settings: {} });
    const result = await (await caller()).offer.generateSigningLink({ offerId: OFFER_ID });
    expect(updateOffer).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: OFFER_ID, organizationId: ORG_ID, status: 'sent', updatedAt }),
      data: expect.objectContaining({ sentAt: updatedAt }),
    }));
    const minted = (updateOffer.mock.calls[0]?.[0] as { data: { settings: { signingToken: string } } }).data.settings.signingToken;
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.signingUrl).toBe(`/offers/sign/${minted}`);
    expect(sendOffer.mock.calls[0]?.[0]).toMatchObject({ signingUrl: `https://example.test/offers/sign/${minted}` });
    expect(JSON.stringify(sendOffer.mock.calls)).not.toContain('undefined');
  });
});
