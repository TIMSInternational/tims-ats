import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock('@tims/auth/middleware', () => ({
  updateSession: async () => ({ supabaseResponse: new Response(null), user: state.user }),
}));
import { middleware } from '../../apps/web/middleware';
import { NextRequest } from '../../apps/web/node_modules/next/server';

beforeEach(() => {
  state.user = null;
});

it('lets a new recipient open the setup link on the canonical app host', async () => {
  const response = await middleware(
    new NextRequest('https://app.tims.com/accept-invitation?token=test', { headers: { host: 'app.tims.com' } }),
  );
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('allows an authenticated recovery session to choose a new secret', async () => {
  state.user = { id: 'authenticated-recovery' };
  const response = await middleware(
    new NextRequest('https://app.tims.com/reset-password?invitation=test', { headers: { host: 'app.tims.com' } }),
  );
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('still redirects anonymous users away from the private dashboard', async () => {
  const response = await middleware(
    new NextRequest('https://app.tims.com/dashboard', { headers: { host: 'app.tims.com' } }),
  );
  expect(response.headers.get('location')).toContain('/login');
});
