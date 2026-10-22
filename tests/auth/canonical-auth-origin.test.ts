import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureCanonicalAuthOrigin } from '../../apps/web/lib/auth/canonical-auth-origin';

// #50, tier-1 (Codex) review: an emailed PKCE flow keeps its code verifier in a cookie on the host
// that STARTED it, while the emailed link lands on the configured origin. A flow started on a
// deployment alias or preview host therefore failed at /auth/callback, even in the same browser.
// The pages that start such a flow must move the user to the configured origin first.

const CONFIGURED = 'https://tims-ats.vercel.app';

function serveFrom(origin: string, pathname = '/forgot-password', search = '', hash = '') {
  const replace = vi.fn();
  vi.stubGlobal('window', { location: { origin, pathname, search, hash, replace } });
  return replace;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ensureCanonicalAuthOrigin', () => {
  it('requesting host != configured host: navigates to the configured host and refuses to start the flow', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', CONFIGURED);
    const replace = serveFrom('https://tims-ats-git-branch.vercel.app', '/careers/acme/login', '?x=1');
    expect(ensureCanonicalAuthOrigin()).toBe(false);
    expect(replace).toHaveBeenCalledWith(`${CONFIGURED}/careers/acme/login?x=1`);
  });

  it('requesting host == configured host: the flow starts here and nothing navigates', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', CONFIGURED);
    const replace = serveFrom(CONFIGURED);
    expect(ensureCanonicalAuthOrigin()).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it('local development with no configured origin is never bounced to production', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    const replace = serveFrom('http://localhost:3000');
    expect(ensureCanonicalAuthOrigin()).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('every page that starts an emailed PKCE flow uses the guard', () => {
  const root = resolve(__dirname, '../..');
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

  it.each([
    'apps/web/app/(auth)/forgot-password/page.tsx',
    'apps/web/app/(auth)/register/register-form.tsx',
    'apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx',
  ])('%s moves the user on mount AND refuses to start the flow off-origin on submit', (file) => {
    const source = read(file);
    expect(source).toMatch(/useCanonicalAuthOrigin\(\);/);
    expect(source).toMatch(/if \(!ensureCanonicalAuthOrigin\(\)\) return;/);
  });

  it('invitation recovery: the page moves on mount and the sender refuses off-origin', () => {
    expect(read('apps/web/app/accept-invitation/page.tsx')).toMatch(/useCanonicalAuthOrigin\(\);/);
    const api = read('apps/web/app/accept-invitation/invitation-setup-api.ts');
    const body = api.slice(api.indexOf('export async function invitationRecovery'));
    expect(body.indexOf('ensureCanonicalAuthOrigin()')).toBeGreaterThan(-1);
    expect(body.indexOf('ensureCanonicalAuthOrigin()')).toBeLessThan(body.indexOf('resetPasswordForEmail('));
  });
});
