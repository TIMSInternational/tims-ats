import { beforeEach, expect, it, vi } from 'vitest';

// E-25: a signed-out request to a staff page goes to /login keeping its path AND query, and says the
// session expired when it still carried a (now invalid) Supabase session cookie.
const state = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock('@tims/auth/middleware', () => ({
  updateSession: async () => ({ supabaseResponse: new Response(null), user: state.user }),
}));
import { middleware } from '../../apps/web/middleware';
import { NextRequest } from '../../apps/web/node_modules/next/server';

beforeEach(() => {
  state.user = null;
});

const location = async (url: string, cookie?: string) => {
  const headers: Record<string, string> = { host: 'app.tims.com' };
  if (cookie) headers.cookie = cookie;
  const res = await middleware(new NextRequest(url, { headers }));
  const value = res.headers.get('location');
  return value ? new URL(value) : null;
};

it('keeps the query of the page the user was sent away from', async () => {
  const loc = await location('https://app.tims.com/recruitment/pipeline?vacancy=v1&stage=s2');
  expect(loc?.pathname).toBe('/login');
  expect(loc?.searchParams.get('redirect')).toBe('/recruitment/pipeline?vacancy=v1&stage=s2');
  expect(loc?.searchParams.has('reason')).toBe(false);
});

it('flags reason=expired when a session cookie no longer resolves to a user', async () => {
  const loc = await location('https://app.tims.com/dashboard', 'sb-abcd1234-auth-token=base64-stale');
  expect(loc?.searchParams.get('redirect')).toBe('/dashboard');
  expect(loc?.searchParams.get('reason')).toBe('expired');
});

it('bounces a signed-in user off /forgot-password but lets /logout through (the reset-password exits sign out first)', async () => {
  state.user = { id: 'lingering-session' };
  expect((await location('https://app.tims.com/forgot-password'))?.pathname).toBe('/');
  expect(await location('https://app.tims.com/logout?next=/forgot-password')).toBeNull();
});

it('does not claim an expiry for a PKCE verifier cookie alone', async () => {
  const loc = await location('https://app.tims.com/dashboard', 'sb-abcd1234-auth-token-code-verifier=v');
  expect(loc?.searchParams.has('reason')).toBe(false);
});
