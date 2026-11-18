/**
 * org-locale-profile-routers.test.ts — the organization locale profile on the tRPC path production uses
 * (NEXT_PUBLIC_ORG_INVITATION_CREATE_VIA_CSHARP is unset): platform.createOrgInvitation and
 * platform.createOrganization write it to settings and the default company; platform.updateOrganization MERGES
 * a settings patch so candidateContactEmail and every other key survive (#201). The C# twins are proved
 * against a real Postgres (PlatformOrganizationsCreateRepositoryTests, OrganizationInvitationEndpointTests,
 * PlatformOrganizationsWriteRepositoryTests).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initTRPC } from '@trpc/server';

const m = vi.hoisted(() => ({
  orgCreate: vi.fn(),
  orgUpdate: vi.fn(),
  queryRaw: vi.fn(),
  provisionDefaults: vi.fn(),
}));

vi.mock('@tims/db', () => {
  const tx = {
    organization: { create: m.orgCreate, update: m.orgUpdate },
    subscription: { create: vi.fn() },
    $queryRaw: m.queryRaw,
  };
  const db = {
    ...tx,
    platformInvitation: {
      create: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', status: 'pending', sentAt: null })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
  };
  return {
    db,
    tenantDb: {},
    SubscriptionStatus: { trialing: 'trialing' },
    OrgPlan: { trial: 'trial', starter: 'starter', professional: 'professional', enterprise: 'enterprise' },
    InvitationType: { org_admin: 'org_admin', user: 'user' },
    InvitationStatus: {
      pending: 'pending',
      sent: 'sent',
      accepted: 'accepted',
      expired: 'expired',
      revoked: 'revoked',
    },
    InvoiceStatus: { pending: 'pending' },
  };
});
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: vi.fn(async () => false) }));
vi.mock('../../packages/api/src/lib/notify', () => ({ notify: vi.fn(async () => undefined) }));
vi.mock('../../packages/api/src/services/org-provisioning', () => ({
  provisionOrgDefaults: m.provisionDefaults,
  provisionOrgEntitlements: vi.fn(),
  provisionOrgRoles: vi.fn(),
}));
vi.mock('../../packages/api/src/routers/platform/platform-audit', () => ({ recordPlatformAudit: vi.fn() }));
vi.mock('@tims/shared', async (original) => ({
  ...(await original<typeof import('@tims/shared')>()),
  getAppUrl: () => 'https://app.example.test',
}));
vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
    .create();
  return { router: t.router, publicProcedure: t.procedure, protectedProcedure: t.procedure };
});

import { invitationsRouter } from '../../packages/api/src/routers/platform/invitations';
import { organizationsRouter } from '../../packages/api/src/routers/platform/organizations';

const t = initTRPC
  .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
  .create();
type Factory = Parameters<typeof t.createCallerFactory>[0];
const ctx = {
  user: { id: 'owner-1', organizationId: '99999999-9999-4999-8999-999999999999', isPlatformOwner: true },
  headers: new Headers(),
};
type AnyCall = (input: Record<string, unknown>) => Promise<unknown>;
const invitations = () =>
  t.createCallerFactory(invitationsRouter as unknown as Factory)(ctx) as unknown as Record<string, AnyCall>;
const organizations = () =>
  t.createCallerFactory(organizationsRouter as unknown as Factory)(ctx) as unknown as Record<string, AnyCall>;

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const GUATEMALA = { country: 'GT', timezone: 'America/Guatemala', currency: 'GTQ', locale: 'es-GT' };
const invite = { email: 'admin@example.test', organizationName: 'Maquila GT', organizationSlug: 'maquila-gt' };
const create = { name: 'Maquila GT', slug: 'maquila-gt', plan: 'trial', adminEmail: 'admin@example.test' };

beforeEach(() => {
  vi.clearAllMocks();
  m.orgCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: ORG_ID, ...data }));
  m.orgUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: ORG_ID, ...data }));
});

describe.each([
  ['createOrgInvitation', () => invitations().createOrgInvitation, invite],
  ['createOrganization', () => organizations().createOrganization, create],
] as const)('platform.%s and the locale profile', (_name, procedure, base) => {
  it('writes the profile to organizations.settings and hands it to the default-company provisioning', async () => {
    await procedure()({ ...base, localeProfile: GUATEMALA });
    expect(m.orgCreate.mock.calls[0][0].data.settings).toEqual(GUATEMALA);
    expect(m.provisionDefaults).toHaveBeenCalledWith(expect.anything(), ORG_ID, 'Maquila GT', GUATEMALA);
  });

  it('without a profile behaves exactly as before: no settings key, no profile for the company', async () => {
    await procedure()({ ...base });
    expect('settings' in m.orgCreate.mock.calls[0][0].data).toBe(false);
    expect(m.provisionDefaults).toHaveBeenCalledWith(expect.anything(), ORG_ID, 'Maquila GT', undefined);
  });

  it.each([
    { ...GUATEMALA, timezone: 'Mars/Olympus' },
    { ...GUATEMALA, currency: 'XYZ' },
    { ...GUATEMALA, country: 'Guatemala' },
    { ...GUATEMALA, locale: 'es_GT' },
    { country: 'GT', timezone: 'America/Guatemala', currency: 'GTQ' },
    { ...GUATEMALA, extra: 'x' },
  ])('rejects an invalid profile before any write (%o)', async (localeProfile) => {
    await expect(procedure()({ ...base, localeProfile })).rejects.toThrow();
    expect(m.orgCreate).not.toHaveBeenCalled();
  });
});

describe('platform.updateOrganization settings', () => {
  const stored = {
    candidateContactEmail: 'talento@maquila.test',
    locale: 'es-CR',
    timezone: 'America/Costa_Rica',
    currency: 'CRC',
    onboarding: { dismissed: true },
  };

  it('MERGES the patch under a row lock: candidateContactEmail and every other key survive', async () => {
    m.queryRaw.mockResolvedValue([{ settings: stored }]);
    await organizations().updateOrganization({
      id: ORG_ID,
      settings: { timezone: 'America/Guatemala', currency: 'GTQ', country: 'GT' },
    });
    const sql = (m.queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/SELECT settings FROM organizations WHERE id = \?::uuid FOR UPDATE/);
    expect(m.queryRaw.mock.calls[0][1]).toBe(ORG_ID);
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: ORG_ID },
      data: {
        settings: {
          candidateContactEmail: 'talento@maquila.test',
          locale: 'es-CR',
          timezone: 'America/Guatemala',
          currency: 'GTQ',
          country: 'GT',
          onboarding: { dismissed: true },
        },
      },
    });
  });

  it('leaves settings alone (no lock, no settings key) when the patch is absent — a rename stays a rename', async () => {
    await organizations().updateOrganization({ id: ORG_ID, name: 'Renombrada' });
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.orgUpdate).toHaveBeenCalledWith({ where: { id: ORG_ID }, data: { name: 'Renombrada' } });
  });

  it.each([{ timezone: 'Mars/Olympus' }, { currency: 'gtq' }, { country: 'gt' }, { candidateContactEmail: 'x@y.z' }])(
    'rejects an invalid or unknown settings key before any read or write (%o)',
    async (settings) => {
      await expect(organizations().updateOrganization({ id: ORG_ID, settings })).rejects.toThrow();
      expect(m.queryRaw).not.toHaveBeenCalled();
      expect(m.orgUpdate).not.toHaveBeenCalled();
    },
  );
});
