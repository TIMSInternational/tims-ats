/**
 * access-review.test.ts — CB-2b
 *
 * Pins the access-review risk kernel (each flag bites) + the wiring of the report /
 * export / attestation surface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
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

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('wiring — access-review surface', () => {
  const router = () => read('packages/api/src/routers/platform/access-review.ts');

  // READ SIDE DELETED (2026-07-31): getAccessReview, exportAccessReviewCsv, and
  // listAccessReviewAttestations — plus their input schemas (accessReviewReportInput,
  // exportAccessReviewCsvInput, listAccessReviewAttestationsInput), the CSV-injection-hardening
  // export procedure, and the access_review_viewed audit event — were removed once
  // NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP was confirmed live in prod; the C# read surface
  // (AccessReviewDbContext) is the sole implementation now. Only attestAccessReview (the write,
  // gated by the separate, still-dark access-review-write flag) survives — see the tests below.

  it('attest is a platform-only procedure', () => {
    expect(router()).toMatch(/attestAccessReview:\s*platformProcedure/);
  });

  it('attest requires an org (attestAccessReviewInput has no .optional() organizationId)', () => {
    const schemas = read('packages/api/src/routers/platform/access-review.schemas.ts');
    expect(schemas).toMatch(/attestAccessReviewInput[\s\S]*organizationId:\s*z\.string\(\)\.uuid\(\),/);
    expect(schemas).not.toMatch(/organizationId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
  });

  it('attest refuses a truncated org rather than persist under-counted evidence', () => {
    expect(read('packages/api/src/services/access-review.service.ts')).toMatch(
      /report\.truncated[\s\S]*PRECONDITION_FAILED|PRECONDITION_FAILED/,
    );
  });

  it('attest records an access_recertified security event (router) + writes the snapshot (repo)', () => {
    expect(router()).toMatch(/logSecurityEvent/);
    expect(router()).toMatch(/access_recertified/);
    expect(read('packages/api/src/repositories/access-review.repository.ts')).toMatch(/accessReview\.create/);
  });

  it('the access-review router is merged into the platform router', () => {
    const platformRoot = read('packages/api/src/routers/platform/index.ts');
    expect(platformRoot).toMatch(/accessReviewRouter/);
  });
});
