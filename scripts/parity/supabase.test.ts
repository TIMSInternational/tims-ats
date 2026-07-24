import { describe, it, expect, vi } from 'vitest';
import { getTokenWith, getSessionCookieWith, formatCookieHeader, type SignIn, type BuildCookie } from './supabase';

describe('formatCookieHeader', () => {
  it('renders a single (unchunked) session cookie', () => {
    expect(formatCookieHeader([{ name: 'sb-ref-auth-token', value: 'base64-abc' }])).toBe(
      'sb-ref-auth-token=base64-abc',
    );
  });

  it('joins chunked cookies (.0/.1) with "; "', () => {
    expect(
      formatCookieHeader([
        { name: 'sb-ref-auth-token.0', value: 'base64-aaa' },
        { name: 'sb-ref-auth-token.1', value: 'bbb' },
      ]),
    ).toBe('sb-ref-auth-token.0=base64-aaa; sb-ref-auth-token.1=bbb');
  });
});

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
