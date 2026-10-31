import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getAppUrl,
  getAuthRedirectUrl,
  checkAppOrigin,
  AppOriginConfigError,
  AuthRedirectPathError,
  DEFAULT_APP_URL,
  getCanonicalAuthFlowUrl,
  isLoopbackHostname,
  type AppOriginIssue,
} from '../../packages/shared/src/app-url';
import { blockAt } from '../helpers/source-blocks';

// Resolves the public app origin for email links (invites, password resets,
// auth callbacks). Must NEVER fall back to a domain we don't control.

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

// ---------------------------------------------------------------------------------------------
// #50 — auth email links: fail loud when unset in a production build, never a loopback origin on
// a deployed host, and every auth email redirect built from the configured origin. These rules
// are AppOriginIssue codes on the same checkAppOrigin()/AppOriginConfigError as the #351 rules.
// ---------------------------------------------------------------------------------------------

function env(values: Record<string, string | undefined>) {
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', undefined);
  vi.stubEnv('NODE_ENV', 'test');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function issueOf(fn: () => unknown): AppOriginIssue | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppOriginConfigError);
    return (e as AppOriginConfigError).issue;
  }
  return undefined;
}

describe('getAppUrl — #50 production fail-loud', () => {
  it('throws `missing` in a production build when unset (no guessed host)', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: undefined });
    expect(issueOf(() => getAppUrl())).toBe('missing');
  });

  it('throws `missing` in a production build when blank', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: '  ' });
    expect(() => getAppUrl()).toThrow(/must be set in production/);
  });

  it('throws `missing` on a Vercel deployment when unset', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: undefined });
    expect(issueOf(() => getAppUrl())).toBe('missing');
  });

  it('still falls back to the canonical origin when unset outside production', () => {
    env({ NEXT_PUBLIC_APP_URL: undefined });
    expect(getAppUrl()).toBe(DEFAULT_APP_URL);
  });
});

describe('getAppUrl — #50 loopback on a deployed host', () => {
  it.each(['http://localhost:3000', 'https://localhost', 'https://127.0.0.1:3000', 'https://[::1]', 'https://0.0.0.0'])(
    'rejects loopback origin %s on Vercel production',
    (value) => {
      env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: value });
      expect(() => getAppUrl()).toThrow(AppOriginConfigError);
    },
  );

  it('rejects an https loopback origin on Vercel production with the loopback code', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://localhost' });
    expect(issueOf(() => getAppUrl())).toBe('loopback_on_deployed_host');
  });

  it('rejects loopback via the client-visible NEXT_PUBLIC_VERCEL_ENV on a preview deployment', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_VERCEL_ENV: 'preview', NEXT_PUBLIC_APP_URL: 'https://localhost' });
    expect(issueOf(() => getAppUrl())).toBe('loopback_on_deployed_host');
  });

  it('rejects plain http on a preview deployment, even for loopback', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'preview', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
    expect(issueOf(() => getAppUrl())).toBe('insecure_http');
  });

  // The client call sites (forgot-password, register, portal magic link, invitation recovery)
  // run in the browser, where VERCEL_ENV is never defined and NEXT_PUBLIC_VERCEL_ENV only exists
  // if it was mirrored/exposed. The #50 guard must hold with NEITHER set: a production page
  // served from a real host must refuse to email a loopback link.
  it.each(['http://localhost:3000', 'https://localhost', 'http://127.0.0.1:3000'])(
    'rejects loopback origin %s in a production browser bundle on a real host with no VERCEL_ENV of any kind',
    (value) => {
      env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: value });
      vi.stubGlobal('location', { hostname: 'tims-ats.vercel.app' });
      expect(issueOf(() => getAppUrl())).toBe('loopback_on_deployed_host');
      expect(() => getAuthRedirectUrl('/auth/callback', { recovery: '1' })).toThrow(/served from a real host/);
    },
  );

  it('still allows a loopback origin for a production bundle served from localhost (CI / local `next start`)', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
    vi.stubGlobal('location', { hostname: 'localhost' });
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  it('does not apply the served-host check outside production builds (dev over a LAN IP)', () => {
    env({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
    vi.stubGlobal('location', { hostname: '192.168.1.20' });
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  it('accepts the real origin in a production browser bundle with no VERCEL_ENV', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    vi.stubGlobal('location', { hostname: 'tims-ats.vercel.app' });
    expect(getAppUrl()).toBe('https://tims-ats.vercel.app');
  });

  it('accepts the prod origin on a deployed production environment', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app/' });
    expect(getAppUrl()).toBe('https://tims-ats.vercel.app');
  });

  it('does not widen the #351 http exception: http://0.0.0.0 is still rejected in a production build', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://0.0.0.0:3000' });
    expect(issueOf(() => getAppUrl())).toBe('insecure_http');
  });

  it('checkAppOrigin reports the #50 codes without throwing', () => {
    expect(checkAppOrigin('https://localhost', { NODE_ENV: 'production', VERCEL_ENV: 'preview' })).toMatchObject({
      ok: false,
      issue: 'loopback_on_deployed_host',
    });
    expect(
      checkAppOrigin('http://127.0.0.1:3000', { NODE_ENV: 'production', servedFromHost: 'ats.example.test' }),
    ).toMatchObject({ ok: false, issue: 'loopback_on_deployed_host' });
    expect(checkAppOrigin('http://127.0.0.1:3000', { NODE_ENV: 'production', servedFromHost: '127.0.0.1' })).toEqual({
      ok: true,
      origin: 'http://127.0.0.1:3000',
    });
  });

  it('the #50 messages never echo the configured value', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://localhost:4443' });
    expect(() => getAppUrl()).toThrow(AppOriginConfigError);
    try {
      getAppUrl();
    } catch (e) {
      expect((e as Error).message).not.toContain('4443');
    }
  });
});

describe('getAuthRedirectUrl', () => {
  it('builds an absolute URL on the configured origin with encoded params', () => {
    env({ NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    expect(getAuthRedirectUrl('/auth/callback', { recovery: '1' })).toBe(
      'https://tims-ats.vercel.app/auth/callback?recovery=1',
    );
    const url = new URL(getAuthRedirectUrl('/auth/callback', { next: '/careers/acme/dashboard' }));
    expect(url.origin).toBe('https://tims-ats.vercel.app');
    expect(url.searchParams.get('next')).toBe('/careers/acme/dashboard');
  });

  it.each([
    '//evil.example/x',
    'https://evil.example/x',
    'auth/callback',
    '/\\evil.example',
    // WHATWG URL parsing strips ASCII tab/LF/CR before resolving, so each of these would
    // otherwise become '//evil.example' — a protocol-relative URL on another host.
    '/\t/evil.example/x',
    '/\n/evil.example',
    '/\r/evil.example',
    '/\r\n/evil.example',
    '\t//evil.example',
  ])('rejects non app-relative path %j (no open redirect)', (path) => {
    env({ NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    expect(() => getAuthRedirectUrl(path)).toThrow(AuthRedirectPathError);
  });

  it('rejects a control character even when it would stay on-origin (no silent stripping)', () => {
    env({ NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    // Without the filter this resolves to https://tims-ats.vercel.app/authcallback: same origin,
    // but not the path the caller wrote. Rejecting it keeps the guard independent of the origin check.
    expect(() => getAuthRedirectUrl('/auth\tcallback')).toThrow(AuthRedirectPathError);
    expect(() => getAuthRedirectUrl('/auth/callback\u007f')).toThrow(AuthRedirectPathError);
  });

  it('never returns a URL off the configured origin, whatever the path', () => {
    env({ NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    // Every 1- and 2-char combination of the characters URL parsing treats specially after a
    // leading '/' — any one that resolved off-origin would be an open redirect.
    const specials = ['/', '\\', '\t', '\n', '\r', ' ', '@', ':', '.', '%', '?', '#', '\u0000', '\u001f'];
    for (const a of specials) {
      for (const b of ['', ...specials]) {
        const path = `/${a}${b}evil.example/x`;
        let result: string | undefined;
        try {
          result = getAuthRedirectUrl(path);
        } catch (error) {
          expect(error).toBeInstanceOf(AuthRedirectPathError);
          continue;
        }
        expect(new URL(result).origin, JSON.stringify(path)).toBe('https://tims-ats.vercel.app');
      }
    }
  });

  it('propagates the production fail-loud when the origin is unset', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: undefined });
    expect(issueOf(() => getAuthRedirectUrl('/auth/callback'))).toBe('missing');
  });

  it('propagates the #351 origin rules (no path on the origin)', () => {
    env({ NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app/app' });
    expect(issueOf(() => getAuthRedirectUrl('/auth/callback'))).toBe('path');
  });
});

describe('apps/web/next.config.ts', () => {
  // Belt and braces for the browser guard above: the deployed-environment checks in getAppUrl()
  // read NEXT_PUBLIC_VERCEL_ENV on the client, which Vercel only provides when a dashboard setting
  // is on. next.config.ts mirrors VERCEL_ENV into it at build time so the guard does not hinge on it.
  it('mirrors VERCEL_ENV into NEXT_PUBLIC_VERCEL_ENV for client bundles', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../../apps/web/next.config.ts'), 'utf8');
    expect(source).toMatch(/env:\s*\{[^}]*NEXT_PUBLIC_VERCEL_ENV:\s*process\.env\.VERCEL_ENV\b/);
  });
});

describe('packages/shared/src/app-url.ts client-bundle safety', () => {
  // Next.js inlines only LITERAL `process.env.X` reads into client bundles. getAppUrl() must not
  // hand `process.env` itself to checkAppOrigin(), or every NODE_ENV/VERCEL_ENV rule switches off
  // in the browser (where `process.env` is an empty object).
  it('getAppUrl() validates against literal env reads, not the dynamic process.env object', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../../packages/shared/src/app-url.ts'), 'utf8');
    const body = blockAt(source, 'export function getAppUrl', { minLines: 8 });
    // One-argument call = the default env; a `process.env` argument = dynamic access.
    expect(body).not.toMatch(/checkAppOrigin\(\s*\w+\s*\)/);
    expect(body).not.toMatch(/checkAppOrigin\([^)]*process\.env\s*\)/);
    expect(body).toMatch(/checkAppOrigin\(raw, env\)/);
    for (const name of ['NODE_ENV', 'VERCEL_ENV', 'NEXT_PUBLIC_VERCEL_ENV']) {
      expect(source).toContain(`process.env.${name}`);
    }
  });
});

// Tier-1 (Codex) review of #50: an exact-match loopback set let `https://127.0.0.2`, `https://localhost.`
// and `https://[::ffff:127.0.0.1]` through checkAppOrigin() on a deployed host.
describe('loopback variants are rejected on a deployed host (#50 tier-1)', () => {
  it.each([
    'https://127.0.0.2',
    'https://127.255.255.254:8443',
    'https://localhost.',
    'https://LOCALHOST..',
    'https://app.localhost',
    'https://[::ffff:127.0.0.1]',
    'https://[::127.0.0.1]',
    'https://[0:0:0:0:0:0:0:1]',
    'https://[::]',
    'https://[::ffff:0.0.0.0]',
    'https://0x7f.1',
    'https://2130706433',
  ])('rejects %s on Vercel production with the loopback code', (value) => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: value });
    expect(issueOf(() => getAppUrl())).toBe('loopback_on_deployed_host');
  });

  it.each([
    'https://tims-ats.vercel.app',
    'https://127.example.com',
    'https://localhost.example.com',
    'https://[::ffff:8.8.8.8]',
    'https://[2001:db8::1]',
    'https://128.0.0.1',
  ])('still accepts the non-loopback origin %s on Vercel production', (value) => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: value });
    expect(() => getAppUrl()).not.toThrow();
  });

  it('applies the same normalisation to the served-from host', () => {
    expect(checkAppOrigin('http://localhost:3000', { NODE_ENV: 'production', servedFromHost: 'localhost.' })).toEqual({
      ok: true,
      origin: 'http://localhost:3000',
    });
    expect(isLoopbackHostname('[::ffff:7f00:1]')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('ats.example.test')).toBe(false);
  });

  it('keeps the #351 http exception exact: http://127.0.0.2 and http://localhost. stay rejected in a production build', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://127.0.0.2:3000' });
    expect(issueOf(() => getAppUrl())).toBe('insecure_http');
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://localhost.:3000' });
    expect(issueOf(() => getAppUrl())).toBe('insecure_http');
  });
});

// Tier-1 (Codex) review of #50: the PKCE verifier lives on the host that STARTS the flow, so a reset
// started on an alias or preview host failed at the canonical /auth/callback. Pages now move the user
// to the configured origin first.
describe('getCanonicalAuthFlowUrl (#50 tier-1)', () => {
  const at = (origin: string, pathname = '/forgot-password', search = '', hash = '') => ({ origin, pathname, search, hash });

  it('returns null on the configured origin, so the flow starts here', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    expect(getCanonicalAuthFlowUrl(at('https://tims-ats.vercel.app'))).toBeNull();
  });

  it('moves a page served from another host to the same path, query and fragment on the configured origin', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'preview', NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    expect(
      getCanonicalAuthFlowUrl(at('https://tims-ats-git-x.vercel.app', '/accept-invitation', '?token=abc', '#top')),
    ).toBe('https://tims-ats.vercel.app/accept-invitation?token=abc#top');
  });

  it('can never leave the configured origin, whatever the served path', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app' });
    for (const pathname of ['//evil.example/x', '/\\evil.example', '/%2F%2Fevil.example', '']) {
      const target = getCanonicalAuthFlowUrl(at('https://alias.example.test', pathname));
      expect(target === null || new URL(target).origin === 'https://tims-ats.vercel.app').toBe(true);
    }
  });

  it('never bounces local development to the prod fallback when NEXT_PUBLIC_APP_URL is unset', () => {
    env({ NEXT_PUBLIC_APP_URL: '' });
    expect(getCanonicalAuthFlowUrl(at('http://localhost:3000'))).toBeNull();
  });

  it('returns null for a misconfigured origin (the flow itself then fails closed)', () => {
    env({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://localhost' });
    expect(getCanonicalAuthFlowUrl(at('https://tims-ats.vercel.app'))).toBeNull();
  });
});

// Tier-1 round 2: in development with NEXT_PUBLIC_APP_URL unset, the page is (correctly) not moved,
// so the emailed link must come back to the SAME host or the PKCE verifier is on the wrong one.
describe('development with no configured origin keeps navigation and email destination together (#50 tier-1 r2)', () => {
  it('a browser flow on localhost is neither moved nor emailed a prod link', () => {
    env({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: '' });
    vi.stubGlobal('location', { origin: 'http://localhost:3000', hostname: 'localhost' });
    const page = { origin: 'http://localhost:3000', pathname: '/forgot-password', search: '', hash: '' };
    expect(getCanonicalAuthFlowUrl(page)).toBeNull();
    expect(getAuthRedirectUrl('/auth/callback', { recovery: '1' })).toBe('http://localhost:3000/auth/callback?recovery=1');
  });

  it('a production build with the origin unset still fails closed, whatever host the page is on', () => {
    env({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: '' });
    vi.stubGlobal('location', { origin: 'https://tims-ats.vercel.app', hostname: 'tims-ats.vercel.app' });
    expect(issueOf(() => getAuthRedirectUrl('/auth/callback'))).toBe('missing');
  });

  it('a configured origin always wins over the served host', () => {
    env({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:3100' });
    vi.stubGlobal('location', { origin: 'http://localhost:3000', hostname: 'localhost' });
    expect(getAuthRedirectUrl('/auth/callback')).toBe('http://localhost:3100/auth/callback');
  });

  it('server callers (no location) keep the canonical fallback outside production', () => {
    env({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: '' });
    expect(getAuthRedirectUrl('/auth/callback')).toBe(`${DEFAULT_APP_URL}/auth/callback`);
  });
});
