/**
 * access-review.test.ts — CB-2b
 *
 * Pins the access-review risk kernel (each flag bites). The TS router/service/repository
 * wiring this file used to also test was deleted 2026-07-31: both the read
 * (NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP) and write (NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP)
 * flags are confirmed live in prod, and with both gone the whole TS app-wiring layer
 * (packages/api/src/routers/platform/access-review.ts + .schemas.ts +
 * services/access-review.service.ts + repositories/access-review.repository.ts) had zero
 * remaining callers and was removed, matching the `reporting` domain precedent (delete the
 * whole router once it's fully dead, don't leave an empty stub). The kernel below
 * (access-review-kernel.ts) stays as a pinned-contract spec the C# port must match — see
 * also tests/parity/access-review-fixtures.test.ts for the golden-fixture pin.
 */
import { describe, it, expect } from 'vitest';
import {
  assessUserAccess,
  accessStatusOf,
  STALE_LOGIN_DAYS,
  type UserAccessInput,
} from '../../packages/api/src/access/access-review-kernel';

const NOW = new Date('2026-07-17T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const ORG = 'org-1';
const role = (slug: string, over: Partial<{ organizationId: string; expiresAt: Date | null }> = {}) => ({
  slug,
  organizationId: over.organizationId ?? ORG,
  expiresAt: over.expiresAt ?? null,
});
const base: UserAccessInput = {
  organizationId: ORG,
  isActive: true,
  deletedAt: null,
  lastLoginAt: daysAgo(1),
  roles: [role('recruiter')],
  isPlatformOwner: false,
  now: NOW,
};

describe('accessStatusOf', () => {
  it('deleted > inactive > active precedence', () => {
    expect(accessStatusOf({ isActive: true, deletedAt: NOW })).toBe('deleted');
    expect(accessStatusOf({ isActive: false, deletedAt: null })).toBe('inactive');
    expect(accessStatusOf({ isActive: true, deletedAt: null })).toBe('active');
  });
});

describe('assessUserAccess — risk flags (each bites)', () => {
  it('a healthy active recruiter raises NO flags', () => {
    expect(assessUserAccess(base).flags).toEqual({
      neverLoggedIn: false,
      stale: false,
      privileged: false,
      deprovisionGap: false,
      expiredGrant: false,
      crossOrgRole: false,
    });
  });

  it('neverLoggedIn: active + no login', () => {
    expect(assessUserAccess({ ...base, lastLoginAt: null }).flags.neverLoggedIn).toBe(true);
    expect(assessUserAccess(base).flags.neverLoggedIn).toBe(false);
  });

  it('stale: active + last login older than STALE_LOGIN_DAYS (boundary bites)', () => {
    expect(assessUserAccess({ ...base, lastLoginAt: daysAgo(STALE_LOGIN_DAYS + 1) }).flags.stale).toBe(true);
    expect(assessUserAccess({ ...base, lastLoginAt: daysAgo(STALE_LOGIN_DAYS - 1) }).flags.stale).toBe(false);
    expect(assessUserAccess({ ...base, lastLoginAt: null }).flags.stale).toBe(false);
  });

  it('privileged: platform_owner / super_admin / isPlatformOwner', () => {
    expect(assessUserAccess({ ...base, roles: [role('super_admin')] }).flags.privileged).toBe(true);
    expect(assessUserAccess({ ...base, isPlatformOwner: true }).flags.privileged).toBe(true);
    expect(assessUserAccess(base).flags.privileged).toBe(false);
  });

  it('deprovisionGap: inactive/deleted but still holds roles', () => {
    expect(assessUserAccess({ ...base, isActive: false }).flags.deprovisionGap).toBe(true);
    expect(assessUserAccess({ ...base, deletedAt: NOW }).flags.deprovisionGap).toBe(true);
    expect(assessUserAccess({ ...base, isActive: false, roles: [], isPlatformOwner: false }).flags.deprovisionGap).toBe(
      false,
    );
    expect(assessUserAccess(base).flags.deprovisionGap).toBe(false);
  });

  it('expiredGrant: active user holding a role whose expiry has passed (LIVE lingering access)', () => {
    expect(
      assessUserAccess({ ...base, roles: [role('recruiter', { expiresAt: daysAgo(1) })] }).flags.expiredGrant,
    ).toBe(true);
    // a future/absent expiry is fine
    expect(
      assessUserAccess({ ...base, roles: [role('recruiter', { expiresAt: daysAgo(-30) })] }).flags.expiredGrant,
    ).toBe(false);
    expect(assessUserAccess(base).flags.expiredGrant).toBe(false);
    // an inactive user's expired role is a deprovisionGap, not counted as expiredGrant (active-only)
    expect(
      assessUserAccess({ ...base, isActive: false, roles: [role('recruiter', { expiresAt: daysAgo(1) })] }).flags
        .expiredGrant,
    ).toBe(false);
  });

  it('crossOrgRole: holds a role belonging to a different org (grant corruption)', () => {
    expect(
      assessUserAccess({ ...base, roles: [role('recruiter', { organizationId: 'org-2' })] }).flags.crossOrgRole,
    ).toBe(true);
    expect(assessUserAccess(base).flags.crossOrgRole).toBe(false);
  });

  it('inactive/deleted accounts never raise the ACTIVE-only flags (stale/neverLoggedIn/expiredGrant)', () => {
    const f = assessUserAccess({
      ...base,
      isActive: false,
      lastLoginAt: null,
      roles: [role('recruiter', { expiresAt: daysAgo(1) })],
    }).flags;
    expect(f.neverLoggedIn).toBe(false);
    expect(f.stale).toBe(false);
    expect(f.expiredGrant).toBe(false);
  });
});
