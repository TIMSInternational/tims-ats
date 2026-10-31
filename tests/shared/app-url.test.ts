import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAppUrl, checkAppOrigin, AppOriginConfigError, DEFAULT_APP_URL } from '../../packages/shared/src/app-url';

// Resolves the public app origin for email links (invites, password resets,
// auth callbacks). Must NEVER fall back to a domain we don't control.

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  vi.unstubAllEnvs();
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

  it('rejects a public HTTP origin in production before a bearer link can be built', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXT_PUBLIC_APP_URL = 'http://ats.example.test';
    expect(() => getAppUrl()).toThrow('Invalid public app origin');
  });

  it.each(['http://localhost:3100', 'http://127.0.0.1:3100', 'http://[::1]:3100'])(
    'allows a loopback origin for local production-mode testing (%s)',
    (origin) => {
      vi.stubEnv('NODE_ENV', 'production');
      process.env.NEXT_PUBLIC_APP_URL = origin;
      expect(getAppUrl()).toBe(origin);
    },
  );

  it('allows HTTP outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.NEXT_PUBLIC_APP_URL = 'http://ats.example.test';
    expect(getAppUrl()).toBe('http://ats.example.test');
  });

  it.each([
    ['https://ats.example.test/', 'https://ats.example.test'],
    ['https://ats.example.test//', 'https://ats.example.test'],
    ['  https://ats.example.test:8443/  ', 'https://ats.example.test:8443'],
  ])('accepts and normalises a trailing-slash origin (%s)', (raw, expected) => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXT_PUBLIC_APP_URL = raw;
    expect(getAppUrl()).toBe(expected);
    expect(`${getAppUrl()}/accept-invitation`).toBe(`${expected}/accept-invitation`);
  });

  it.each(['https://ats.example.test/app', 'https://ats.example.test/app/'])(
    'rejects a real path with a clear configuration error that does not echo the value (%s)',
    (raw) => {
      process.env.NEXT_PUBLIC_APP_URL = raw;
      let caught: unknown;
      try {
        getAppUrl();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AppOriginConfigError);
      expect((caught as AppOriginConfigError).issue).toBe('path');
      expect((caught as Error).message).toMatch(/NEXT_PUBLIC_APP_URL must be an origin only .* remove the path/);
      expect((caught as Error).message).not.toContain('ats.example.test');
    },
  );

  it('Vercel production rejects http even for a loopback host', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    expect(() => getAppUrl()).toThrow(/must use https in production/);
  });

  it('Vercel production accepts an https origin', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    process.env.NEXT_PUBLIC_APP_URL = 'https://tims-ats.vercel.app/';
    expect(getAppUrl()).toBe('https://tims-ats.vercel.app');
  });

  it('allows http://localhost in test and development', () => {
    vi.stubEnv('NODE_ENV', 'test');
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    expect(getAppUrl()).toBe('http://localhost:3000');
    vi.stubEnv('NODE_ENV', 'development');
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  it('checkAppOrigin reports the issue without throwing', () => {
    expect(checkAppOrigin('http://ats.example.test', { NODE_ENV: 'production' })).toEqual({
      ok: false,
      issue: 'insecure_http',
      message: expect.stringContaining('https'),
    });
    expect(checkAppOrigin('https://ats.example.test/', { VERCEL_ENV: 'production' })).toEqual({
      ok: true,
      origin: 'https://ats.example.test',
    });
  });

  it.each([
    'ftp://ats.example.test',
    'javascript:alert(1)',
    'https://user:pass@ats.example.test',
    'https://ats.example.test/path',
    'https://ats.example.test/?token=secret',
    'https://ats.example.test/#fragment',
    'not a url',
  ])('rejects an invalid or non-origin app URL (%s)', (origin) => {
    process.env.NEXT_PUBLIC_APP_URL = origin;
    expect(() => getAppUrl()).toThrow('Invalid public app origin');
  });
});
