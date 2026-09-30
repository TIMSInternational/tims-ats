import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// The signing token is a bearer credential for salary/terms (getBySigningToken) and for accept/decline.
// A re-send reuses it only when it was issued to the candidate's CURRENT address; a changed address (or a
// legacy row that never recorded one) rotates it, so a copy delivered to a wrong/typo'd address dies.
// The fake below is stateful — lookups by token see what the router actually wrote — so "the old link no
// longer resolves" is observed through the real public procedures, not inferred from a call shape.

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OFFER_ID = '22222222-2222-2222-2222-222222222222';

interface Row {
  id: string;
  organizationId: string;
  status: string;
  settings: Record<string, unknown>;
  updatedAt: Date;
  sentAt: Date | null;
  expiresAt: Date | null;
  candidate: { firstName: string; lastName: string; email: string; updatedAt: Date };
  vacancy: { title: string };
  organization: { name: string; logo: null };
}

let row: Row;
const snapshot = (): Row => structuredClone(row);

type Where = {
  id?: string;
  organizationId?: string;
  status?: string;
  updatedAt?: Date;
  settings?: { path: string[]; equals: unknown };
};
function matches(where: Where): boolean {
  if (where.id !== undefined && where.id !== row.id) return false;
  if (where.organizationId !== undefined && where.organizationId !== row.organizationId) return false;
  if (where.status !== undefined && where.status !== row.status) return false;
  if (where.updatedAt !== undefined && where.updatedAt.getTime() !== row.updatedAt.getTime()) return false;
  if (where.settings !== undefined && row.settings[where.settings.path[0]!] !== where.settings.equals) return false;
  return true;
}

const findFirst = vi.fn(async () => snapshot());
const findMany = vi.fn(async ({ where }: { where: Where }) => (matches(where) ? [snapshot()] : []));
const updateMany = vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
  if (!matches(where)) return { count: 0 };
  row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1000) };
  return { count: 1 };
});
const sendOffer = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    offer: { findFirst, findMany, updateMany },
    organization: { findFirst: vi.fn(async () => ({ name: 'Example Company' })) },
    user: { findMany: vi.fn(async () => []) },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  // The public token procedures enter an explicit unscoped scope (signingTokenProcedure).
  runUnscoped: (_reason: string, fn: () => unknown) => fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: {
    sendOfferToCandidate: sendOffer,
    notifyOfferAccepted: vi.fn(),
    notifyOfferDeclined: vi.fn(),
  },
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

const tokenOf = (signingUrl: string | null) => signingUrl!.replace('/offers/sign/', '');
const storedToken = () => row.settings.signingToken as string;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
  row = {
    id: OFFER_ID,
    organizationId: ORG_ID,
    status: 'approved',
    settings: {},
    updatedAt: new Date('2026-09-28T10:00:00Z'),
    sentAt: null,
    expiresAt: null,
    candidate: {
      firstName: 'QA',
      lastName: 'Candidate',
      email: 'typo@example.test',
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    },
    vacancy: { title: 'QA role' },
    organization: { name: 'Example Company', logo: null },
  };
  sendOffer.mockResolvedValue(true);
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe('signing-token rotation on re-send', () => {
  it('records the normalised recipient on first send', async () => {
    row.candidate.email = '  Typo@Example.TEST ';
    const api = await caller();
    const first = await api.offer.generateSigningLink({ offerId: OFFER_ID });
    expect(row.status).toBe('sent');
    expect(row.settings).toEqual({
      signingToken: tokenOf(first.signingUrl),
      signingTokenRecipient: 'typo@example.test',
    });
  });

  it('reuses the token when re-sent to the same address (case/whitespace-insensitive), writing nothing', async () => {
    const api = await caller();
    const first = await api.offer.generateSigningLink({ offerId: OFFER_ID });
    row.candidate.email = ' TYPO@example.test';
    const again = await api.offer.generateSigningLink({ offerId: OFFER_ID });

    expect(again.signingUrl).toBe(first.signingUrl);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(sendOffer).toHaveBeenCalledTimes(2);
    expect(sendOffer.mock.calls[1]![0].signingUrl).toBe(`https://example.test${first.signingUrl}`);
  });

  it('rotates when the candidate email changed: the old link dies, the new address gets the new link', async () => {
    const api = await caller();
    const first = await api.offer.generateSigningLink({ offerId: OFFER_ID });
    const oldToken = tokenOf(first.signingUrl);
    await expect(api.offer.getBySigningToken({ token: oldToken })).resolves.toMatchObject({ id: OFFER_ID });

    row.candidate.email = 'right@example.test';
    const sentUpdatedAt = row.updatedAt;
    const again = await api.offer.generateSigningLink({ offerId: OFFER_ID });
    const newToken = tokenOf(again.signingUrl);

    expect(newToken).not.toBe(oldToken);
    expect(storedToken()).toBe(newToken);
    expect(row.settings.signingTokenRecipient).toBe('right@example.test');
    expect(row.status).toBe('sent');
    // Written through the compare-and-set, org-scoped.
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: OFFER_ID, organizationId: ORG_ID, status: 'sent', updatedAt: sentUpdatedAt },
      }),
    );
    expect(sendOffer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        candidateEmail: 'right@example.test',
        signingUrl: `https://example.test/offers/sign/${newToken}`,
      }),
    );

    await expect(api.offer.getBySigningToken({ token: oldToken })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(api.offer.acceptByToken({ token: oldToken, signatureName: 'Mallory' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(api.offer.declineByToken({ token: oldToken })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(row.status).toBe('sent');
    await expect(api.offer.getBySigningToken({ token: newToken })).resolves.toMatchObject({ id: OFFER_ID });
  });

  it('rotates a legacy sent offer that never recorded a recipient, even for the same address', async () => {
    row.status = 'sent';
    row.sentAt = new Date('2026-09-20T00:00:00Z');
    row.settings = { signingToken: 'legacy-token', signatureNote: 'kept' };
    const api = await caller();

    const again = await api.offer.generateSigningLink({ offerId: OFFER_ID });
    const newToken = tokenOf(again.signingUrl);

    expect(newToken).not.toBe('legacy-token');
    expect(row.settings).toEqual({
      signingToken: newToken,
      signingTokenRecipient: 'typo@example.test',
      signatureNote: 'kept',
    });
    expect(row.sentAt).toEqual(new Date('2026-09-20T00:00:00Z'));
    await expect(api.offer.getBySigningToken({ token: 'legacy-token' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('fails CONFLICT without emailing when the rotation loses the compare-and-set', async () => {
    row.status = 'sent';
    row.settings = { signingToken: 'old-token', signingTokenRecipient: 'typo@example.test' };
    row.candidate.email = 'right@example.test';
    // A concurrent writer bumps the row between the read and the conditional write.
    findFirst.mockImplementationOnce(async () => {
      const seen = snapshot();
      row.updatedAt = new Date(row.updatedAt.getTime() + 5000);
      return seen;
    });
    const api = await caller();

    await expect(api.offer.generateSigningLink({ offerId: OFFER_ID })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(sendOffer).not.toHaveBeenCalled();
    expect(storedToken()).toBe('old-token');
  });

  it('a link rotated between lookup and transition cannot accept or decline', async () => {
    row.status = 'sent';
    row.settings = { signingToken: 'rotated-token', signingTokenRecipient: 'right@example.test' };
    const stale = { ...snapshot(), settings: { signingToken: 'old-token' } };
    const api = await caller();

    findMany.mockResolvedValueOnce([stale]);
    await expect(api.offer.acceptByToken({ token: 'old-token', signatureName: 'Mallory' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    findMany.mockResolvedValueOnce([stale]);
    await expect(api.offer.declineByToken({ token: 'old-token' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(row.status).toBe('sent');

    await expect(api.offer.acceptByToken({ token: 'rotated-token', signatureName: 'Right Person' })).resolves.toEqual({
      success: true,
    });
    expect(row.status).toBe('accepted');
  });
});

describe('redactOfferSettings', () => {
  it('strips the token and its recipient from staff reads, keeping other settings', async () => {
    const { redactOfferSettings } = await import('../../packages/api/src/routers/offer/offer-dto');
    const out = redactOfferSettings({
      id: 'o1',
      settings: { signingToken: 't', signingTokenRecipient: 'a@b.c', acceptedAt: 'x' },
    });
    expect(out.settings).toEqual({ acceptedAt: 'x' });
  });
});
