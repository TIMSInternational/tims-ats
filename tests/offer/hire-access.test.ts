import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// E-06 / B-07 / C-31 — a hire that REUSES an existing sign-in identity (every portal applicant has one)
// used to get no email at all: no password, no word about "Mi Onboarding". The hand-off now:
//   - provisionStaffIdentity reports whether Supabase sent an invitation (`invited`);
//   - generatePasswordSetupLink asks Supabase for a single-use recovery link to /reset-password?setup=1;
//   - deliverHireAccess emails it in Spanish ("usted") with the org's contact as Reply-To, and reports
//     exactly what happened so the hire screen can say so.

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  inviteUserByEmail: vi.fn(),
  generateLink: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  db: {
    $queryRaw: (...args: unknown[]) => h.queryRaw(...args),
    user: { findUnique: (a: unknown) => h.userFindUnique(a), update: (a: unknown) => h.userUpdate(a) },
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { inviteUserByEmail: h.inviteUserByEmail, generateLink: h.generateLink } },
  }),
}));
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: (p: unknown) => h.sendEmail(p) }));

const SUPABASE = 'https://project-ref.supabase.co';
const APP = 'https://app.example.org';
const ACTION_LINK = `${SUPABASE}/auth/v1/verify?token=abc&type=recovery&redirect_to=${encodeURIComponent(`${APP}/reset-password?setup=1`)}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-tests');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP);
  h.userFindUnique.mockResolvedValue(null);
  h.generateLink.mockResolvedValue({ data: { properties: { action_link: ACTION_LINK } }, error: null });
  h.sendEmail.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('provisionStaffIdentity', () => {
  it('reuses an existing identity and says no invitation went out', async () => {
    h.queryRaw.mockResolvedValue([{ id: 'portal-uid' }]);
    const { provisionStaffIdentity } = await import('../../packages/api/src/services/staff-provisioning.service');
    await expect(provisionStaffIdentity('ana@example.org')).resolves.toEqual({
      supabaseUserId: 'portal-uid',
      invited: false,
    });
    expect(h.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('invites a brand-new identity and says so', async () => {
    h.queryRaw.mockResolvedValue([]);
    h.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null });
    const { provisionStaffIdentity, resolveStaffSupabaseUserId } =
      await import('../../packages/api/src/services/staff-provisioning.service');
    await expect(provisionStaffIdentity('new@example.org')).resolves.toEqual({
      supabaseUserId: 'new-uid',
      invited: true,
    });
    expect(h.inviteUserByEmail).toHaveBeenCalledWith('new@example.org', {
      redirectTo: `${APP}/reset-password?setup=1`,
    });
    // The id-only wrapper user.create uses is unchanged.
    await expect(resolveStaffSupabaseUserId('new@example.org')).resolves.toBe('new-uid');
  });
});

describe('generatePasswordSetupLink', () => {
  it('asks for a recovery link that lands on the password page, and sends nothing itself', async () => {
    const { generatePasswordSetupLink } = await import('../../packages/api/src/services/staff-provisioning.service');
    await expect(generatePasswordSetupLink('ana@example.org')).resolves.toBe(ACTION_LINK);
    expect(h.generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'ana@example.org',
      options: { redirectTo: `${APP}/reset-password?setup=1` },
    });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('returns null on a provider error or a link that is not this project’s https verify link', async () => {
    const { generatePasswordSetupLink } = await import('../../packages/api/src/services/staff-provisioning.service');
    h.generateLink.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(generatePasswordSetupLink('ana@example.org')).resolves.toBeNull();
    h.generateLink.mockResolvedValueOnce({
      data: { properties: { action_link: 'https://evil.example/verify' } },
      error: null,
    });
    await expect(generatePasswordSetupLink('ana@example.org')).resolves.toBeNull();
    h.generateLink.mockResolvedValueOnce({ data: { properties: { action_link: 'javascript:alert(1)' } }, error: null });
    await expect(generatePasswordSetupLink('ana@example.org')).resolves.toBeNull();
    h.generateLink.mockRejectedValueOnce(new Error('network'));
    await expect(generatePasswordSetupLink('ana@example.org')).resolves.toBeNull();
  });
});

const base = {
  email: 'ana@example.org',
  firstName: 'Ana',
  organizationName: 'Org Piloto',
  jobTitle: 'Analista',
  startDate: new Date('2026-11-16T18:00:00.000Z'),
  timeZone: 'America/Costa_Rica',
  contactEmail: 'talento@example.org',
  locale: 'es' as const,
};

describe('deliverHireAccess', () => {
  it('sends nothing extra for a brand-new identity (Supabase already sent the invitation)', async () => {
    const { deliverHireAccess } = await import('../../packages/api/src/services/hire-access.service');
    await expect(deliverHireAccess({ ...base, invited: true })).resolves.toEqual({
      kind: 'invitation_sent',
      email: 'ana@example.org',
    });
    expect(h.generateLink).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('emails the set-password link to a reused identity, replying to the organization contact', async () => {
    const { deliverHireAccess } = await import('../../packages/api/src/services/hire-access.service');
    await expect(deliverHireAccess({ ...base, invited: false })).resolves.toEqual({
      kind: 'setup_link_sent',
      email: 'ana@example.org',
    });
    const sent = h.sendEmail.mock.calls[0][0] as { to: string; subject: string; html: string; replyTo: string };
    expect(sent.to).toBe('ana@example.org');
    expect(sent.replyTo).toBe('talento@example.org');
    expect(sent.subject).toBe('Org Piloto: active su acceso a Mi Onboarding');
    expect(sent.html).toContain(ACTION_LINK.replace(/&/g, '&amp;'));
    expect(sent.html).toContain(`${APP}/login`);
    expect(sent.html).toContain(`${APP}/forgot-password`);
  });

  it('reports a failure (never a false "sent") when no link can be made or the mail is refused', async () => {
    const { deliverHireAccess } = await import('../../packages/api/src/services/hire-access.service');
    h.generateLink.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
    await expect(deliverHireAccess({ ...base, invited: false })).resolves.toEqual({
      kind: 'setup_link_failed',
      email: 'ana@example.org',
    });
    expect(h.sendEmail).not.toHaveBeenCalled();

    h.sendEmail.mockResolvedValueOnce(false);
    await expect(deliverHireAccess({ ...base, invited: false })).resolves.toEqual({
      kind: 'setup_link_failed',
      email: 'ana@example.org',
    });
  });
});

describe('hireAccessEmail (template)', () => {
  const params = { ...base, setupUrl: ACTION_LINK, appUrl: APP };

  it('speaks "usted", names the job and the start date in the organization zone, and gives the way back in', async () => {
    const { hireAccessEmail } = await import('../../packages/api/src/services/hire-access-email');
    const { html } = hireAccessEmail(params);
    expect(html).toContain('Estimado/a Ana:');
    expect(html).toContain('Crear mi contraseña');
    expect(html).toContain('16 de noviembre de 2026');
    expect(html).toContain('«Mi Onboarding»');
    expect(html).toMatch(/solicite uno nuevo/);
    expect(html).toContain('mailto:talento@example.org');
    expect(html).not.toMatch(/\b(tu|tú|te)\b/i);
  });

  it('escapes every dynamic value and drops an unsafe greeting name', async () => {
    const { hireAccessEmail } = await import('../../packages/api/src/services/hire-access-email');
    const { html, subject } = hireAccessEmail({
      ...params,
      firstName: 'evil.com <script>',
      organizationName: 'Org\r\nBcc: x@y.z <b>',
      jobTitle: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Estimado/a:');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('omits the contact line when the organization has no candidate contact (never a vendor mailbox)', async () => {
    const { hireAccessEmail } = await import('../../packages/api/src/services/hire-access-email');
    const { html } = hireAccessEmail({ ...params, contactEmail: null });
    expect(html).not.toContain('mailto:');
    expect(html).not.toMatch(/escríbanos/);
  });

  it('has an English variant for English-language companies', async () => {
    const { hireAccessEmail } = await import('../../packages/api/src/services/hire-access-email');
    const { html, subject } = hireAccessEmail({ ...params, locale: 'en' });
    expect(subject).toBe('Org Piloto: activate your access to My Onboarding');
    expect(html).toContain('Create my password');
  });
});
