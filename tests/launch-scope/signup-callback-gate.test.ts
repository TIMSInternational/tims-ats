import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// /auth/callback company-signup branch behind SELF_SERVE_SIGNUP_ENABLED, plus the portal-aware
// failure redirect. Mocks follow tests/auth/callback-company-slug.test.ts.

const state = vi.hoisted(() => ({
  exchangeError: null as null | { message: string },
  metadata: { account_type: 'company', company_name: 'INVU Pilot', full_name: 'Ana Pérez' } as Record<string, string>,
  existingUser: null as null | { id: string },
  orgCreates: 0,
  signOuts: 0,
}));

vi.mock('../../packages/auth/src/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: state.exchangeError }),
      getUser: async () => ({
        data: { user: { id: 'supabase-user-1', email: 'founder@example.com', user_metadata: state.metadata } },
      }),
      signOut: async () => {
        state.signOuts += 1;
        return { error: null };
      },
    },
  }),
}));

vi.mock('@tims/db', () => {
  const tx = {
    organization: {
      create: vi.fn(async () => {
        state.orgCreates += 1;
        return { id: 'org-1' };
      }),
    },
    role: { findUniqueOrThrow: vi.fn(async () => ({ id: 'role-1' })) },
    user: { create: vi.fn(async () => ({ id: 'user-1' })) },
    userRole: { create: vi.fn(async () => ({})) },
    subscription: { create: vi.fn(async () => ({})) },
  };
  return {
    db: {
      user: { findFirst: vi.fn(async () => state.existingUser) },
      platformOwnerEmail: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('@tims/api', () => ({
  provisionOrgDefaults: vi.fn(async () => ({})),
  provisionOrgEntitlements: vi.fn(async () => undefined),
  provisionOrgRoles: vi.fn(async () => undefined),
}));

import { GET } from '../../apps/web/app/auth/callback/route';
import { isSelfServeSignupEnabled } from '../../apps/web/lib/self-serve-signup';

const BASE = 'https://ats.example.com';
const call = async (qs: string) => (await GET(new Request(`${BASE}/auth/callback?${qs}`))).headers.get('location');

beforeEach(() => {
  state.exchangeError = null;
  state.metadata = { account_type: 'company', company_name: 'INVU Pilot', full_name: 'Ana Pérez' };
  state.existingUser = null;
  state.orgCreates = 0;
  state.signOuts = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('isSelfServeSignupEnabled', () => {
  it('defaults OFF in Vercel production and ON elsewhere; explicit values win', () => {
    expect(isSelfServeSignupEnabled({ VERCEL_ENV: 'production' })).toBe(false);
    expect(isSelfServeSignupEnabled({ VERCEL_ENV: 'preview' })).toBe(true);
    expect(isSelfServeSignupEnabled({})).toBe(true);
    expect(isSelfServeSignupEnabled({ SELF_SERVE_SIGNUP_ENABLED: 'false' })).toBe(false);
    expect(isSelfServeSignupEnabled({ SELF_SERVE_SIGNUP_ENABLED: 'true', VERCEL_ENV: 'production' })).toBe(true);
  });
});

describe('company signup gate in /auth/callback', () => {
  it('OFF: does not create an org, signs the session out, and redirects to /login with a message', async () => {
    vi.stubEnv('SELF_SERVE_SIGNUP_ENABLED', 'false');
    expect(await call('code=abc&type=company')).toBe(`${BASE}/login?error=registration_closed`);
    expect(state.orgCreates).toBe(0);
    expect(state.signOuts).toBe(1);
  });

  it('OFF by default in Vercel production, including the metadata-only (password signup) path', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(await call('code=abc')).toBe(`${BASE}/login?error=registration_closed`);
    expect(state.orgCreates).toBe(0);
  });

  it('ON: keeps creating the org and landing on /dashboard', async () => {
    vi.stubEnv('SELF_SERVE_SIGNUP_ENABLED', 'true');
    expect(await call('code=abc&type=company')).toBe(`${BASE}/dashboard`);
    expect(state.orgCreates).toBe(1);
    expect(state.signOuts).toBe(0);
  });

  it('OFF never blocks an existing linked user (OAuth login)', async () => {
    vi.stubEnv('SELF_SERVE_SIGNUP_ENABLED', 'false');
    state.existingUser = { id: 'user-9' };
    expect(await call('code=abc&type=company')).toBe(`${BASE}/dashboard`);
    expect(state.signOuts).toBe(0);
  });

  it('OFF never touches the candidate portal magic link', async () => {
    vi.stubEnv('SELF_SERVE_SIGNUP_ENABLED', 'false');
    state.metadata = {};
    expect(await call(`code=abc&next=${encodeURIComponent('/careers/invu/dashboard')}`)).toBe(
      `${BASE}/careers/invu/dashboard`,
    );
    expect(state.signOuts).toBe(0);
  });

  it('OFF never touches invitation acceptance', async () => {
    vi.stubEnv('SELF_SERVE_SIGNUP_ENABLED', 'false');
    const invitationId = ['123e4567', 'e89b', '42d3', 'a456', '426614174000'].join('-');
    expect(await call(`code=abc&invitation=${invitationId}`)).toBe(`${BASE}/accept-invitation?token=${invitationId}`);
    expect(state.orgCreates).toBe(0);
  });
});

describe('failed code exchange', () => {
  it('sends a portal sign-in back to that portal login with error=link', async () => {
    state.exchangeError = { message: 'invalid flow state' };
    expect(await call(`code=abc&next=${encodeURIComponent('/careers/invu/dashboard')}`)).toBe(
      `${BASE}/careers/invu/login?error=link`,
    );
  });

  it('keeps staff failures on /login?error=auth_callback_error (and rejects non-portal next)', async () => {
    state.exchangeError = { message: 'invalid flow state' };
    expect(await call('code=abc')).toBe(`${BASE}/login?error=auth_callback_error`);
    expect(await call(`code=abc&next=${encodeURIComponent('//evil.example/careers/x')}`)).toBe(
      `${BASE}/login?error=auth_callback_error`,
    );
  });
});

describe('portal-aware failure without a code (Codex P2)', () => {
  const portalNext = `next=${encodeURIComponent('/careers/invu/dashboard')}`;

  it('no code + portal next → that portal login with error=link', async () => {
    expect(await call(portalNext)).toBe(`${BASE}/careers/invu/login?error=link`);
  });

  it('no code + no next keeps the staff /login?error=no_code', async () => {
    expect(await call('')).toBe(`${BASE}/login?error=no_code`);
    expect(await call(`next=${encodeURIComponent('/dashboard')}`)).toBe(`${BASE}/login?error=no_code`);
    expect(await call(`next=${encodeURIComponent('//evil.example/careers/x')}`)).toBe(`${BASE}/login?error=no_code`);
  });

  it('Supabase error query params + portal next → error=link, without attempting an exchange', async () => {
    const qs = `error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&${portalNext}`;
    expect(await call(qs)).toBe(`${BASE}/careers/invu/login?error=link`);
    expect(await call(`error_code=otp_expired&${portalNext}`)).toBe(`${BASE}/careers/invu/login?error=link`);
    // Even if a code rides along, the reported error wins for the portal.
    expect(await call(`code=abc&error=access_denied&${portalNext}`)).toBe(`${BASE}/careers/invu/login?error=link`);
  });

  it('Supabase error query params without a portal next keep the staff /login?error=no_code', async () => {
    expect(await call('error=access_denied&error_code=otp_expired')).toBe(`${BASE}/login?error=no_code`);
  });
});
