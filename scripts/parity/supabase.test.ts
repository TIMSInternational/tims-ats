import { describe, it, expect, vi } from 'vitest';
import { getTokenWith, getSessionCookieWith, type SignIn, type BuildCookie } from './supabase';

describe('getTokenWith', () => {
  it('calls signIn once per email then serves cache', async () => {
    const signIn: SignIn = vi.fn(async (e) => `tok-${e}`);
    const cache = new Map<string, string>();
    expect(await getTokenWith(signIn, 'a@x', 'p', cache)).toBe('tok-a@x');
    expect(await getTokenWith(signIn, 'a@x', 'p', cache)).toBe('tok-a@x');
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});

describe('getSessionCookieWith', () => {
  it('builds the cookie once per email then serves cache', async () => {
    const buildCookie: BuildCookie = vi.fn(async (e) => `sb-ref-auth-token=cookie-${e}`);
    const cache = new Map<string, string>();
    expect(await getSessionCookieWith(buildCookie, 'a@x', 'p', cache)).toBe('sb-ref-auth-token=cookie-a@x');
    expect(await getSessionCookieWith(buildCookie, 'a@x', 'p', cache)).toBe('sb-ref-auth-token=cookie-a@x');
    expect(buildCookie).toHaveBeenCalledTimes(1);
  });
});
