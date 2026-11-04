import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot auth WP: SSO dead end (E-01), deep links through login (E-25), Spanish auth errors (E-12),
// pilot-only login panel (E-11), MFA first run (D-03 / E-20). Pure helpers + the /logout route.

const ssr = vi.hoisted(() => ({ signOuts: 0 }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      signOut: async () => {
        ssr.signOuts += 1;
        return { error: null };
      },
    },
  }),
}));

import {
  hasSupabaseSessionCookie,
  safeStaffRedirectPath,
  staffLoginUrl,
} from '../../apps/web/lib/auth/staff-login-redirect';
import { isSsoSignInOffered } from '../../apps/web/lib/auth/sso-sign-in';
import { authErrorMessage } from '../../apps/web/app/(auth)/auth-error-message';
import { loginErrorMessage, loginNoticeMessage } from '../../apps/web/app/(auth)/login/login-error-message';
import { authHeroPills } from '../../apps/web/app/(auth)/auth-hero';
import { isMfaRequiredFor } from '../../apps/web/app/mfa/mfa-requirement';
import { LAUNCH_HIDDEN_HREFS } from '../../apps/web/lib/launch-scope';
import { GET as logout } from '../../apps/web/app/logout/route';
import { NextRequest } from '../../apps/web/node_modules/next/server';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

afterEach(() => vi.unstubAllEnvs());

describe('safeStaffRedirectPath', () => {
  it('keeps a same-origin path with its query', () => {
    expect(safeStaffRedirectPath('/recruitment/pipeline?vacancy=abc&stage=2')).toBe(
      '/recruitment/pipeline?vacancy=abc&stage=2',
    );
    expect(safeStaffRedirectPath('/')).toBe('/');
  });

  it.each([
    ['absolute URL', 'https://evil.example/x'],
    ['protocol-relative', '//evil.example/x'],
    ['backslash host escape', '/\\evil.example'],
    ['dot-segment host escape', '/.//evil.example'],
    ['scheme without slash', 'javascript:alert(1)'],
    ['control character', '/dashboard\n'],
    ['relative path', 'dashboard'],
    ['empty', ''],
    ['over-long', `/${'a'.repeat(2048)}`],
  ])('rejects %s', (_label, raw) => {
    expect(safeStaffRedirectPath(raw)).toBeNull();
  });

  it('rejects the auth pages themselves (a loop or a spent one-time link)', () => {
    for (const p of [
      '/login',
      '/logout?x=1',
      '/auth/callback',
      '/reset-password?setup=1',
      '/forgot-password',
      '/register',
    ]) {
      expect(safeStaffRedirectPath(p)).toBeNull();
    }
    expect(safeStaffRedirectPath('/dashboard/../login')).toBeNull();
    // Segment-aware: a page that merely starts with the same letters is fine.
    expect(safeStaffRedirectPath('/loginsights')).toBe('/loginsights');
  });

  it('returns null for missing input', () => {
    expect(safeStaffRedirectPath(null)).toBeNull();
    expect(safeStaffRedirectPath(undefined)).toBeNull();
  });
});

describe('hasSupabaseSessionCookie / staffLoginUrl', () => {
  it('recognises the session cookie, chunked or not, and ignores the PKCE verifier and blanks', () => {
    expect(hasSupabaseSessionCookie([{ name: 'sb-abcd1234-auth-token', value: 'base64-x' }])).toBe(true);
    expect(hasSupabaseSessionCookie([{ name: 'sb-abcd1234-auth-token.0', value: 'chunk' }])).toBe(true);
    expect(hasSupabaseSessionCookie([{ name: 'sb-abcd1234-auth-token-code-verifier', value: 'v' }])).toBe(false);
    expect(hasSupabaseSessionCookie([{ name: 'sb-abcd1234-auth-token', value: '' }])).toBe(false);
    expect(hasSupabaseSessionCookie([{ name: 'tims-locale', value: 'ES' }])).toBe(false);
  });

  it('carries path + query and flags an expired session', () => {
    const url = staffLoginUrl('https://app.example/recruitment?x=1', '/recruitment/pipeline?vacancy=v1', true);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirect')).toBe('/recruitment/pipeline?vacancy=v1');
    expect(url.searchParams.get('reason')).toBe('expired');
  });

  it('drops an unsafe target and adds no reason without a prior session', () => {
    const url = staffLoginUrl('https://app.example/', '//evil.example', false);
    expect(url.searchParams.has('redirect')).toBe(false);
    expect(url.searchParams.has('reason')).toBe(false);
  });
});

describe('authErrorMessage (E-12)', () => {
  const fallback = es.auth.loginFailed;
  it.each([
    [{ code: 'invalid_credentials', status: 400 }, es.auth.invalidCredentials],
    [{ message: 'Invalid login credentials', status: 400 }, es.auth.invalidCredentials],
    [{ code: 'email_not_confirmed', status: 400 }, es.auth.emailNotConfirmed],
    [{ code: 'over_email_send_rate_limit', status: 429 }, es.auth.authRateLimited],
    [{ code: 'over_request_rate_limit' }, es.auth.authRateLimited],
    [{ status: 429, message: 'Too many requests' }, es.auth.authRateLimited],
    [{ code: 'user_banned', status: 400 }, es.auth.accountDisabled],
    [{ code: 'email_address_invalid', status: 400 }, es.auth.invalidEmail],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, es.auth.authNetworkError],
    [{ code: 'request_timeout', status: 504 }, es.auth.authNetworkError],
  ])('maps %o to Spanish copy', (error, expected) => {
    expect(authErrorMessage(error, es.auth, fallback)).toBe(expected);
  });

  it('never surfaces the provider text for an unknown error', () => {
    expect(
      authErrorMessage({ code: 'unexpected_failure', message: 'Database error saving new user' }, es.auth, fallback),
    ).toBe(fallback);
    expect(authErrorMessage(new Error('boom'), es.auth, fallback)).toBe(fallback);
    expect(authErrorMessage('boom', es.auth, fallback)).toBe(fallback);
    expect(authErrorMessage(null, es.auth, fallback)).toBe(fallback);
  });
});

describe('login messages', () => {
  it('explains a sign-in that found no TIMS user (E-01)', () => {
    expect(loginErrorMessage('no_access', es.auth)).toBe(es.auth.noAccess);
    expect(es.auth.noAccess).toMatch(/invitación/);
    expect(es.auth.noAccess).toMatch(/portal de empleo/);
    expect(loginErrorMessage('something_else', es.auth)).toBeNull();
  });

  it('says the session expired only for reason=expired (E-25)', () => {
    expect(loginNoticeMessage('expired', es.auth)).toBe(es.auth.sessionExpired);
    expect(loginNoticeMessage(null, es.auth)).toBeNull();
    expect(loginNoticeMessage('other', es.auth)).toBeNull();
  });
});

describe('launch scope on the auth screens (E-01 / E-11)', () => {
  it('hides Google / Microsoft sign-in only in the pilot', () => {
    expect(isSsoSignInOffered('pilot')).toBe(false);
    expect(isSsoSignInOffered('full')).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    expect(isSsoSignInOffered()).toBe(false);
  });

  it('advertises only the pilot modules in the pilot, and every pill has es + en copy', () => {
    expect(authHeroPills('pilot')).toEqual(['recruitment', 'interviews', 'offers', 'onboarding']);
    expect(authHeroPills('full')).toContain('nineBox');
    for (const key of [...authHeroPills('pilot'), ...authHeroPills('full')]) {
      expect(es.auth.heroPills[key]).toBeTruthy();
      expect(en.auth.heroPills[key]).toBeTruthy();
    }
    // None of the pilot pills name a module the pilot hides (/people/performance, assessments, analytics).
    expect(LAUNCH_HIDDEN_HREFS).toContain('/people/performance');
    expect(authHeroPills('pilot')).not.toContain('performance');
    expect(authHeroPills('pilot')).not.toContain('assessments');
    expect(authHeroPills('pilot')).not.toContain('analytics');
  });

  it('uses one product name', () => {
    expect(es.auth.platformName).toBe('TIMS ATS');
    expect(en.auth.platformName).toBe('TIMS ATS');
    expect(es.auth.developedBy).toBe('Desarrollado por');
  });
});

describe('isMfaRequiredFor (D-03 / E-20)', () => {
  const superAdmin = { isPlatformOwner: false, roleSlugs: ['super_admin'] };
  it('mirrors the gate: enforced flag AND privileged staff', () => {
    expect(isMfaRequiredFor('true', superAdmin)).toBe(true);
    expect(isMfaRequiredFor('true', { isPlatformOwner: true, roleSlugs: [] })).toBe(true);
    expect(isMfaRequiredFor('true', { isPlatformOwner: false, roleSlugs: ['recruiter'] })).toBe(false);
    expect(isMfaRequiredFor('false', superAdmin)).toBe(false);
    expect(isMfaRequiredFor(undefined, superAdmin)).toBe(false);
    expect(isMfaRequiredFor('true', null)).toBe(false);
  });
});

describe('/logout reason forwarding (E-01)', () => {
  beforeEach(() => {
    ssr.signOuts = 0;
  });

  it('signs out and forwards reason=no_access to /login?error=no_access', async () => {
    const res = await logout(new NextRequest('https://app.example/logout?reason=no_access'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.example/login?error=no_access');
    expect(ssr.signOuts).toBe(1);
  });

  it('drops unknown reasons and keeps the plain /login exit', async () => {
    const res = await logout(new NextRequest('https://app.example/logout?reason=%3Cscript%3E'));
    expect(res.headers.get('location')).toBe('https://app.example/login');
    const plain = await logout(new NextRequest('https://app.example/logout'));
    expect(plain.headers.get('location')).toBe('https://app.example/login');
    expect(ssr.signOuts).toBe(2);
  });
});
