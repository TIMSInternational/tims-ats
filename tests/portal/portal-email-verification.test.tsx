import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Candidate-portal email verification (docs/architecture/candidate-portal-email-verification.md): the portal
// identifies a candidate by email, so an UNCONFIRMED Supabase email must never resolve a candidate — not in the
// dashboard page, not in the tRPC candidate identity. Applying stays frictionless (no session involved).

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  findOrg: vi.fn(),
  getDisplayCandidate: vi.fn(),
  getContactEmail: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@tims/auth/server', () => ({ getUser: m.getUser }));
vi.mock('@tims/db', () => ({ db: { organization: { findUnique: m.findOrg } } }));
vi.mock('@tims/api', () => ({
  candidatePortalService: { getDisplayCandidate: m.getDisplayCandidate, getContactEmail: m.getContactEmail },
}));
const withdrawnAt = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));
vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/consent-status', () => ({
  findConsentWithdrawnAt: withdrawnAt,
}));
vi.mock('next/navigation', () => ({
  redirect: m.redirect,
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

import PortalDashboardPage from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/page';
import { DashboardVerifyEmail } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-verify-email';
import { PortalDashboardShell } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-shell';

const params = Promise.resolve({ orgSlug: 'acme' });

beforeEach(() => {
  vi.clearAllMocks();
  m.findOrg.mockResolvedValue({ id: 'org-1', name: 'Acme', isActive: true, companies: [] });
  m.getDisplayCandidate.mockResolvedValue({ firstName: 'Ana', lastName: 'G' });
  m.getContactEmail.mockReturnValue(null);
});

describe('candidate dashboard requires a confirmed email', () => {
  it('an unconfirmed email gets the verify notice and no candidate lookup', async () => {
    m.getUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: null });
    const element = (await PortalDashboardPage({ params })) as { type: unknown; props: { orgSlug: string } };
    expect(element.type).toBe(DashboardVerifyEmail);
    expect(element.props.orgSlug).toBe('acme');
    expect(m.getDisplayCandidate).not.toHaveBeenCalled();
    expect(m.findOrg).not.toHaveBeenCalled();
  });

  it('a confirmed email reaches the dashboard', async () => {
    m.getUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: '2026-09-30T10:00:00Z' });
    const element = (await PortalDashboardPage({ params })) as { type: unknown; props: { hasCandidate: boolean } };
    expect(element.type).toBe(PortalDashboardShell);
    expect(element.props.hasCandidate).toBe(true);
    expect(m.getDisplayCandidate).toHaveBeenCalledWith('org-1', 'ana@example.com');
  });

  it('passes the candidate\'s own details and the organization contact to the dashboard (C-33)', async () => {
    m.getUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: '2026-09-30T10:00:00Z' });
    const org = { id: 'org-1', name: 'Acme', isActive: true, settings: {}, billingEmail: 'rrhh@acme.test', companies: [] };
    m.findOrg.mockResolvedValue(org);
    m.getDisplayCandidate.mockResolvedValue({ firstName: 'Ana', lastName: 'G', phone: '+506 8888 8888', location: null });
    m.getContactEmail.mockReturnValue('rrhh@acme.test');
    const element = (await PortalDashboardPage({ params })) as {
      props: { profile: unknown; contactEmail: string | null };
    };
    expect(element.props.profile).toEqual({
      firstName: 'Ana',
      lastName: 'G',
      email: 'ana@example.com',
      phone: '+506 8888 8888',
      location: null,
    });
    expect(element.props.contactEmail).toBe('rrhh@acme.test');
    expect(m.getContactEmail).toHaveBeenCalledWith(org);
    // The contact is resolved from the org row, so billingEmail must be selected with it.
    expect(m.findOrg.mock.calls[0]?.[0]).toMatchObject({ select: { settings: true, billingEmail: true } });
  });

  it('has no profile without a candidate', async () => {
    m.getUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: '2026-09-30T10:00:00Z' });
    m.getDisplayCandidate.mockResolvedValue(null);
    const element = (await PortalDashboardPage({ params })) as { props: { profile: unknown; hasCandidate: boolean } };
    expect(element.props.hasCandidate).toBe(false);
    expect(element.props.profile).toBeNull();
    // A confirmed sign-up with no application here never receives the organization's mailbox.
    expect((element.props as { contactEmail?: string | null }).contactEmail).toBeNull();
    expect(m.getContactEmail).not.toHaveBeenCalled();
  });

  it('passes the persisted withdrawal time to the dashboard (#312)', async () => {
    m.getUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: '2026-09-30T10:00:00Z' });
    withdrawnAt.mockResolvedValueOnce('2026-10-01T10:00:00.000Z');
    const element = (await PortalDashboardPage({ params })) as { props: { consentWithdrawnAt: string | null } };
    expect(element.props.consentWithdrawnAt).toBe('2026-10-01T10:00:00.000Z');
    expect(withdrawnAt).toHaveBeenCalledWith('org-1', 'ana@example.com');
  });

  it('shows dates in the organization zone, else the primary company zone — the chain the emails use', async () => {
    m.getUser.mockResolvedValue({ id: 'u1', email: 'ana@example.com', email_confirmed_at: '2026-09-30T10:00:00Z' });
    const render = async (org: Record<string, unknown>) => {
      m.findOrg.mockResolvedValueOnce({ id: 'org-1', name: 'Acme', isActive: true, billingEmail: null, ...org });
      return ((await PortalDashboardPage({ params })) as { props: { timeZone: string | null } }).props.timeZone;
    };
    expect(await render({ settings: { timezone: 'America/Guatemala' }, companies: [{ timezone: 'America/Bogota' }] })).toBe(
      'America/Guatemala',
    );
    // Before: settings only, so an organization without a configured zone showed UTC while its emails did not.
    expect(await render({ settings: {}, companies: [{ timezone: 'America/Guatemala' }] })).toBe('America/Guatemala');
    expect(await render({ settings: {}, companies: [] })).toBeNull();
    // The primary company is the oldest ACTIVE one.
    expect(m.findOrg.mock.calls[0]?.[0]).toMatchObject({
      select: { companies: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, take: 1, select: { timezone: true } } },
    });
  });

  it('no session still goes to login', async () => {
    m.getUser.mockResolvedValue(null);
    await expect(PortalDashboardPage({ params })).rejects.toThrow('REDIRECT:/careers/acme/login');
  });
});

describe('tRPC candidate identity requires a confirmed email', () => {
  it('route.ts only surfaces supabaseAuth for a confirmed email', () => {
    const route = readFileSync(join(__dirname, '../../apps/web/app/api/trpc/[trpc]/route.ts'), 'utf8');
    const decl = route.match(/const supabaseAuth =[^;]+;/);
    expect(decl?.[0]).toContain('email_confirmed_at');
  });
});
