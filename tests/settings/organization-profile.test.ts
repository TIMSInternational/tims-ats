/**
 * "Datos de la organización" (D-11) and the narrowed organization.getCurrent (D-20).
 *
 * D-20: getCurrent returned the full organization row (settings, billingEmail) plus every active company
 * (taxId, legalName) to every staff session, committee and employee included. It now selects a minimal
 * projection and never returns the raw settings, the billing email or company tax data.
 * D-11: no page showed the country, currency, time zone or language the product uses. getCurrent now
 * projects them in the same order the interview emails resolve them (no new tRPC procedure: the surface
 * ratchet forbids one).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectOrganizationProfile } from '../../packages/api/src/services/organization-profile';
import { careersPageUrl, countryLabel, currencyLabel, languageLabel } from '../../apps/web/lib/org-profile-format';
import { timeZoneOptions } from '../../apps/web/lib/time-zone-options';

const h = vi.hoisted(() => ({ findOrg: vi.fn() }));

vi.mock('@tims/db', () => ({
  db: { auditLog: { create: vi.fn() } },
  Prisma: {},
  tenantDb: { organization: { findUnique: (args: unknown) => h.findOrg(args) } },
  runTenantTransaction: vi.fn(),
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));
const allow = { allowed: true, scope: 'organization', roles: ['super_admin'] };
vi.mock('../../packages/api/src/access/build', () => ({ buildAccessForUser: vi.fn().mockResolvedValue(allow) }));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: vi.fn().mockReturnValue(null) }));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue(allow),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));
vi.mock('../../packages/api/src/lib/cache', () => ({
  invalidatePermissionCache: vi.fn(),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function makeCaller(roles: string[]) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { organizationRouter } = await import('../../packages/api/src/routers/organization');
  const ctx = {
    user: {
      id: 'b1ffcd00-0d1c-4f09-8c7e-7cc0ce491b22',
      organizationId: ORG_ID,
      roles,
      isPlatformOwner: false,
      email: 'a@x.test',
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  };
  return createCallerFactory(router({ organization: organizationRouter }))(ctx as never);
}

const company = { name: 'Pilot Co', country: 'CR', currency: 'CRC', timezone: 'America/Costa_Rica', language: 'es' };
const orgRow = (settings: unknown, companies = [company]) => ({
  id: ORG_ID,
  name: 'Pilot',
  slug: 'pilot',
  logo: null,
  settings,
  billingEmail: 'billing@pilot.test',
  companies,
});

beforeEach(() => vi.clearAllMocks());

describe('organization.getCurrent (D-20 + D-11)', () => {
  it('selects explicitly, projects the locale profile and never returns settings, billingEmail or tax data', async () => {
    h.findOrg.mockResolvedValue(
      orgRow({
        timezone: 'America/Costa_Rica',
        currency: 'CRC',
        locale: 'es-CR',
        candidateContactEmail: 'RRHH@Pilot.test',
      }),
    );
    const p = await (await makeCaller(['committee'])).organization.getCurrent();
    expect(p).toEqual({
      id: ORG_ID,
      name: 'Pilot',
      slug: 'pilot',
      logo: null,
      country: 'CR',
      currency: 'CRC',
      currencySource: 'organization',
      timeZone: 'America/Costa_Rica',
      timeZoneSource: 'organization',
      locale: 'es-CR',
      localeSource: 'organization',
      candidateContactEmail: 'rrhh@pilot.test',
      candidateContactSource: 'organization',
      companyName: 'Pilot Co',
    });
    const args = h.findOrg.mock.calls[0]![0] as { select?: Record<string, unknown>; include?: unknown };
    expect(args.include).toBeUndefined();
    expect(args.select).toBeDefined();
    expect(JSON.stringify(args.select)).not.toMatch(/taxId|legalName/);
    // billingEmail is read (it is the documented candidate-contact fallback) but never returned raw.
    expect(p).not.toHaveProperty('billingEmail');
    expect(p).not.toHaveProperty('settings');
  });

  it('returns null when the organization does not exist', async () => {
    h.findOrg.mockResolvedValue(null);
    await expect((await makeCaller(['employee'])).organization.getCurrent()).resolves.toBeNull();
  });
});

describe('projectOrganizationProfile', () => {
  it('falls back to the company values and says where they came from', () => {
    const p = projectOrganizationProfile(orgRow({}));
    expect(p).toMatchObject({
      currency: 'CRC',
      currencySource: 'company',
      timeZone: 'America/Costa_Rica',
      timeZoneSource: 'company',
      locale: 'es',
      localeSource: 'company',
    });
    // Codex round 2: the billing fallback is reported as a SOURCE only; the billing address never leaves.
    expect(p.candidateContactEmail).toBeNull();
    expect(p.candidateContactSource).toBe('billing');
    expect(JSON.stringify(p)).not.toContain('billing@pilot.test');
  });
  it('shows nothing rather than a malformed value; no company means no fallback', () => {
    const p = projectOrganizationProfile(
      orgRow({ timezone: 'Mars/Base', currency: 'colones', locale: '<script>' }, []),
    );
    expect(p).toMatchObject({
      country: null,
      currency: null,
      currencySource: null,
      timeZone: null,
      timeZoneSource: null,
      locale: null,
      localeSource: null,
    });
  });
});

describe('card formatting (web)', () => {
  it('names the country, currency and language instead of printing codes', () => {
    expect(countryLabel('CR', 'es')).toBe('Costa Rica (CR)');
    expect(currencyLabel('CRC', 'es')).toMatch(/^CRC · colón/);
    expect(languageLabel('es-CR', 'es')).toMatch(/español/);
    expect(countryLabel(null, 'es')).toBeNull();
    expect(careersPageUrl('https://app.test/', 'pilot org')).toBe('https://app.test/careers/pilot%20org');
  });
  it('time zone options label Costa Rica as "hora de Costa Rica (GMT-6)" and keep an unlisted current zone', () => {
    const options = timeZoneOptions('es', 'Asia/Tokyo', new Date('2026-11-04T12:00:00Z'));
    expect(options[0]?.value).toBe('Asia/Tokyo');
    expect(options.find((o) => o.value === 'America/Costa_Rica')?.label).toBe(
      'hora de Costa Rica (GMT-6) · America/Costa_Rica',
    );
    expect(options.find((o) => o.value === 'UTC')?.label).toBe('UTC');
    expect(timeZoneOptions('es', 'not/a-zone').some((o) => o.value === 'not/a-zone')).toBe(false);
  });
});
