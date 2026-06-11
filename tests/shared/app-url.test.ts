import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAppUrl, DEFAULT_APP_URL } from '../../packages/shared/src/app-url';

// Resolves the public app origin for email links (invites, password resets,
// auth callbacks). Must NEVER fall back to a domain we don't control.

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
});

describe('getAppUrl', () => {
  it('returns NEXT_PUBLIC_APP_URL when set', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://tims-ats.vercel.app';
    expect(getAppUrl()).toBe('https://tims-ats.vercel.app');
  });

  it('strips any trailing slash so `${getAppUrl()}/path` is well-formed', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/';
    expect(getAppUrl()).toBe('https://example.com');
  });

  it('falls back to the canonical prod URL when unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(getAppUrl()).toBe(DEFAULT_APP_URL);
  });

  it('falls back when set to an empty/whitespace value', () => {
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    expect(getAppUrl()).toBe(DEFAULT_APP_URL);
  });

  it('never falls back to a domain we do not own', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(getAppUrl()).not.toContain('timsats.com');
    expect(DEFAULT_APP_URL).not.toContain('timsats.com');
  });
});
