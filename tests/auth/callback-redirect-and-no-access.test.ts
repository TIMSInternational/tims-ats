import { beforeEach, describe, expect, it, vi } from 'vitest';

// /auth/callback (pilot auth WP): a staff sign-in returns to the page it started from (E-25), and a
// sign-in that finds no TIMS user is signed out WITH a reason /login can explain (E-01). Mocks follow
// tests/launch-scope/signup-callback-gate.test.ts.

const state = vi.hoisted(() => ({ existingUser: null as null | { id: string } }));

vi.mock('../../packages/auth/src/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { id: 'supabase-user-1', email: 'someone@example.com', user_metadata: {} } } }),
      signOut: async () => ({ error: null }),
    },
  }),
}));
vi.mock('@tims/db', () => ({
  db: {
    user: { findFirst: vi.fn(async () => state.existingUser), create: vi.fn() },
    platformOwnerEmail: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(),
  },
}));
vi.mock('@tims/api', () => ({
  provisionOrgDefaults: vi.fn(),
  provisionOrgEntitlements: vi.fn(),
  provisionOrgRoles: vi.fn(),
}));

import { GET } from '../../apps/web/app/auth/callback/route';

const BASE = 'https://ats.example.com';
const call = async (qs: string) => (await GET(new Request(`${BASE}/auth/callback?${qs}`))).headers.get('location');

beforeEach(() => {
  state.existingUser = null;
});

describe('/auth/callback staff sign-in', () => {
  it('returns a linked user to the safe page they came from, query included', async () => {
    state.existingUser = { id: 'user-1' };
    const target = '/recruitment/pipeline?vacancy=v1';
    expect(await call(`code=abc&redirect=${encodeURIComponent(target)}`)).toBe(`${BASE}${target}`);
  });

  it('falls back to /dashboard for a missing or unsafe redirect', async () => {
    state.existingUser = { id: 'user-1' };
    expect(await call('code=abc')).toBe(`${BASE}/dashboard`);
    expect(await call(`code=abc&redirect=${encodeURIComponent('//evil.example')}`)).toBe(`${BASE}/dashboard`);
    expect(await call(`code=abc&redirect=${encodeURIComponent('/\\evil.example')}`)).toBe(`${BASE}/dashboard`);
    expect(await call(`code=abc&redirect=${encodeURIComponent('/logout')}`)).toBe(`${BASE}/dashboard`);
  });

  it('signs out a sign-in with no TIMS user with a reason /login explains', async () => {
    expect(await call(`code=abc&redirect=${encodeURIComponent('/dashboard')}`)).toBe(`${BASE}/logout?reason=no_access`);
  });
});
