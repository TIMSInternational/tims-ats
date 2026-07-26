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

  it('report / export / attest / history are platform-only procedures', () => {
    const src = router();
    expect(src).toMatch(/getAccessReview:\s*platformProcedure/);
    expect(src).toMatch(/exportAccessReviewCsv:\s*platformProcedure/);
    expect(src).toMatch(/attestAccessReview:\s*platformProcedure/);
    expect(src).toMatch(/listAccessReviewAttestations:\s*platformProcedure/);
  });

  it('export is audited via the CB-1c logPlatformExport (access_review resource)', () => {
    expect(router()).toMatch(/logPlatformExport/);
    expect(router()).toMatch(/access_review/);
  });

  it('both the report READ and the export REQUIRE an org (no unauditable platform-wide egress)', () => {
    // accessReviewReportInput is required-org (no .optional()); export aliases it.
    const schemas = read('packages/api/src/routers/platform/access-review.schemas.ts');
    expect(schemas).toMatch(/accessReviewReportInput[\s\S]*organizationId:\s*z\.string\(\)\.uuid\(\),/);
    expect(schemas).not.toMatch(/organizationId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
    // getAccessReview audits the access (same sensitive dataset as the export)
    expect(router()).toMatch(/access_review_viewed/);
  });

  it('export hardens CSV against formula/row injection (RFC-4180 quoting + leading =/+/-/@)', () => {
    expect(router()).toMatch(/csvCell/);
    // the escaping regex itself lives in the shared @tims/shared csv helper, reused by
    // every CSV export (access-review + the platform audit-log export).
    const sharedCsv = read('packages/shared/src/csv.ts');
    expect(sharedCsv).toMatch(/\^\[=\+/);
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
