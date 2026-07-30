import { describe, it, expect } from 'vitest';
import { isSafePortalNext } from '../../apps/web/lib/portal-auth';

// The /auth/callback honors a `next` redirect target for portal (candidate)
// logins. It MUST only ever redirect to a same-origin /careers/ path — anything
// else is rejected (open-redirect prevention), so the value can be safely
// concatenated onto `origin`.
describe('isSafePortalNext', () => {
  it('accepts a same-origin /careers/ path', () => {
    expect(isSafePortalNext('/careers/tims-international/me')).toBe('/careers/tims-international/me');
    expect(isSafePortalNext('/careers/acme/me')).toBe('/careers/acme/me');
  });

  it('accepts the new candidate dashboard path (and its assessment sub-routes)', () => {
    expect(isSafePortalNext('/careers/tims-international/dashboard')).toBe('/careers/tims-international/dashboard');
    expect(isSafePortalNext('/careers/acme/dashboard/assessments/a1')).toBe('/careers/acme/dashboard/assessments/a1');
  });

  it('rejects protocol-relative and absolute URLs (open redirect)', () => {
    expect(isSafePortalNext('//evil.com')).toBeNull();
    expect(isSafePortalNext('//evil.com/careers/x')).toBeNull();
    expect(isSafePortalNext('https://evil.com')).toBeNull();
    expect(isSafePortalNext('http://evil.com/careers/x')).toBeNull();
  });

  it('rejects non-/careers/ same-origin paths (no escape into the staff app)', () => {
    expect(isSafePortalNext('/dashboard')).toBeNull();
    expect(isSafePortalNext('/platform/users')).toBeNull();
    expect(isSafePortalNext('/careers')).toBeNull(); // must be UNDER /careers/
  });

  it('rejects path-traversal that escapes /careers/ after normalization', () => {
    expect(isSafePortalNext('/careers/../dashboard')).toBeNull();
    expect(isSafePortalNext('/careers/../../platform/users')).toBeNull();
  });

  it('preserves a legit query string and normalizes in-bounds traversal', () => {
    expect(isSafePortalNext('/careers/acme/me?ref=x')).toBe('/careers/acme/me?ref=x');
    expect(isSafePortalNext('/careers/acme/./me')).toBe('/careers/acme/me');
  });

  it('rejects control chars / backslashes / empty', () => {
    expect(isSafePortalNext('/careers/x\n/y')).toBeNull();
    expect(isSafePortalNext('/careers/x\\..\\evil')).toBeNull();
    expect(isSafePortalNext('')).toBeNull();
    expect(isSafePortalNext(null)).toBeNull();
    expect(isSafePortalNext(undefined)).toBeNull();
  });
});
