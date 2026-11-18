/**
 * MFA_EXTRA_PRIVILEGED_ROLES — owner-controlled widening of the MFA step-up set.
 *
 * The base privileged set (platform owners + super_admin / platform_owner) is unchanged by
 * default. Listing tenant roles (e.g. `hr_admin,hrbp`) in the env var makes those roles step up
 * too, on every web path that already asks `isMfaPrivileged` WITHOUT passing `extraRoles`: the
 * tRPC middleware (packages/api/src/trpc.ts), the (admin) page layout and the /mfa page.
 * The cross-stack parse/decision goldens live in contracts/mfa-fixtures/cases.json.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isMfaEnforced,
  isMfaGateBlocking,
  isMfaPrivileged,
  MFA_EXTRA_PRIVILEGED_ROLES_ENV,
  MFA_EXTRA_PRIVILEGED_ROLE_CHOICES,
} from '@tims/shared';
import { ASSIGNABLE_STAFF_ROLES } from '@tims/shared';
import { isMfaRequiredFor } from '../../apps/web/app/mfa/mfa-requirement';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isMfaPrivileged reads MFA_EXTRA_PRIVILEGED_ROLES per call', () => {
  it('is the documented variable name', () => {
    expect(MFA_EXTRA_PRIVILEGED_ROLES_ENV).toBe('MFA_EXTRA_PRIVILEGED_ROLES');
  });

  it('unset: hr_admin is not privileged (default behaviour unchanged)', () => {
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, undefined);
    expect(isMfaPrivileged({ roles: ['hr_admin'], isPlatformOwner: false })).toBe(false);
  });

  it('set: listed roles become privileged; unlisted roles do not', () => {
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, 'hr_admin,hrbp');
    expect(isMfaPrivileged({ roles: ['hr_admin'], isPlatformOwner: false })).toBe(true);
    expect(isMfaPrivileged({ roles: ['hrbp'], isPlatformOwner: false })).toBe(true);
    expect(isMfaPrivileged({ roles: ['recruiter'], isPlatformOwner: false })).toBe(false);
    expect(isMfaPrivileged({ roles: ['super_admin'], isPlatformOwner: false })).toBe(true);
  });

  it('rollback: removing the variable takes effect on the next call', () => {
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, 'hr_admin');
    expect(isMfaPrivileged({ roles: ['hr_admin'], isPlatformOwner: false })).toBe(true);
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, '');
    expect(isMfaPrivileged({ roles: ['hr_admin'], isPlatformOwner: false })).toBe(false);
  });

  it('an explicit extraRoles argument overrides the environment', () => {
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, 'hr_admin');
    expect(isMfaPrivileged({ roles: ['hr_admin'], isPlatformOwner: false, extraRoles: [] })).toBe(false);
  });

  it('the addable roles are tenant staff roles only (never candidate / external)', () => {
    for (const slug of MFA_EXTRA_PRIVILEGED_ROLE_CHOICES) {
      expect((ASSIGNABLE_STAFF_ROLES as readonly string[]).includes(slug)).toBe(true);
    }
    expect(MFA_EXTRA_PRIVILEGED_ROLE_CHOICES).not.toContain('super_admin');
  });
});

describe('the gate decision with the variable set (MFA_ENFORCED on)', () => {
  const blocks = (roles: string[], aal: string | null) =>
    isMfaGateBlocking({
      enforced: isMfaEnforced(process.env.MFA_ENFORCED),
      isPrivileged: isMfaPrivileged({ roles, isPlatformOwner: false }),
      currentLevel: aal,
    });

  it('blocks an aal1 hr_admin, lets an aal2 hr_admin through, never touches recruiters', () => {
    vi.stubEnv('MFA_ENFORCED', 'true');
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, 'hr_admin');
    expect(blocks(['hr_admin'], 'aal1')).toBe(true);
    expect(blocks(['hr_admin'], null)).toBe(true);
    expect(blocks(['hr_admin'], 'aal2')).toBe(false);
    expect(blocks(['recruiter'], 'aal1')).toBe(false);
  });

  it('does nothing while MFA_ENFORCED is off, even with the variable set', () => {
    vi.stubEnv('MFA_ENFORCED', 'false');
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, 'hr_admin');
    expect(blocks(['hr_admin'], 'aal1')).toBe(false);
  });

  it('the /mfa page reports the step-up as mandatory for a listed role', () => {
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, 'hr_admin');
    expect(isMfaRequiredFor('true', { isPlatformOwner: false, roleSlugs: ['hr_admin'] })).toBe(true);
    vi.stubEnv(MFA_EXTRA_PRIVILEGED_ROLES_ENV, '');
    expect(isMfaRequiredFor('true', { isPlatformOwner: false, roleSlugs: ['hr_admin'] })).toBe(false);
  });
});

describe('wiring — every web enforcement point picks the variable up', () => {
  // These call sites must NOT pass `extraRoles`, or they would ignore the owner's variable and
  // the stacks would drift (one refusing a session the other serves).
  const callSites = [
    'packages/api/src/trpc.ts',
    'apps/web/app/(admin)/layout.tsx',
    'apps/web/app/mfa/mfa-requirement.ts',
  ];
  it.each(callSites)('%s calls isMfaPrivileged without an extraRoles override', (path) => {
    const src = read(path);
    const calls = src.match(/isMfaPrivileged\(\{[^}]*\}\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) expect(call).not.toMatch(/extraRoles/);
  });
});
