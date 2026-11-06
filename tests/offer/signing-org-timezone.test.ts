import { describe, expect, it, vi } from 'vitest';

// The public offer signing page formats the start date in the organization's time zone, like the
// candidate portal — so the payload carries that zone, and nothing else from organizations.settings.

const findMany = vi.hoisted(() => vi.fn());

vi.mock('@tims/db', () => {
  const tenantDb = { offer: { findMany } };
  return {
    tenantDb,
    runTenantTransaction: async (_org: string, fn: (tx: unknown) => Promise<unknown>) => fn(tenantDb),
    runWithTenant: (_org: string, fn: () => unknown) => fn(),
    runUnscoped: (_reason: string, fn: () => unknown) => fn(),
  };
});

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerSigningRouter } = await import('../../packages/api/src/routers/offer/signing');
  return createCallerFactory(router({ offer: offerSigningRouter }))({
    user: null,
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

const row = (settings: unknown) => ({
  id: '22222222-2222-4222-8222-222222222222',
  status: 'sent',
  salary: 10_200_000,
  currency: 'CRC',
  startDate: new Date('2026-11-09T18:00:00Z'),
  contractType: 'Plazo indefinido',
  benefits: null,
  terms: null,
  sentAt: new Date('2026-11-04T18:00:00Z'),
  expiresAt: null,
  candidate: { firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.test' },
  vacancy: { title: 'Analista' },
  organization: { name: 'Example Org', logo: null, settings },
});

describe('offer.getBySigningToken organization time zone', () => {
  it('returns the organization zone and never the raw settings JSON', async () => {
    findMany.mockResolvedValue([row({ timezone: 'America/Costa_Rica', internal: 'do-not-leak' })]);
    const offer = await (await caller()).offer.getBySigningToken({ token: 'tok' });
    expect(offer.organization).toEqual({ name: 'Example Org', logo: null, timeZone: 'America/Costa_Rica' });
    expect(JSON.stringify(offer)).not.toContain('do-not-leak');
    expect(findMany.mock.calls[0]![0].select.organization).toEqual({ select: { name: true, logo: true, settings: true } });
  });

  it('returns null for a missing or invalid zone', async () => {
    findMany.mockResolvedValue([row({ timezone: 'Mars/Olympus' })]);
    const offer = await (await caller()).offer.getBySigningToken({ token: 'tok' });
    expect(offer.organization.timeZone).toBeNull();
  });
});
