import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createUserSchema, assignRoleSchema } from '../../packages/shared/src/validators/user';
import { ASSIGNABLE_STAFF_ROLES, filterStaffRoleSlugs } from '../../packages/shared/src/types/roles';

describe('external/candidate are NOT staff-assignable roles (codex high)', () => {
  it('ASSIGNABLE_STAFF_ROLES excludes the non-User principals', () => {
    expect(ASSIGNABLE_STAFF_ROLES).not.toContain('external');
    expect(ASSIGNABLE_STAFF_ROLES).not.toContain('candidate');
  });

  it('assignRoleSchema rejects external and candidate', () => {
    const base = { userId: '11111111-1111-1111-1111-111111111111' };
    expect(assignRoleSchema.safeParse({ ...base, roleSlug: 'external' }).success).toBe(false);
    expect(assignRoleSchema.safeParse({ ...base, roleSlug: 'candidate' }).success).toBe(false);
    expect(assignRoleSchema.safeParse({ ...base, roleSlug: 'recruiter' }).success).toBe(true);
  });

  it('createUserSchema rejects external and candidate roleSlug', () => {
    const base = { email: 'a@b.com', firstName: 'A', lastName: 'B' };
    expect(createUserSchema.safeParse({ ...base, roleSlug: 'external' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, roleSlug: 'candidate' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, roleSlug: 'employee' }).success).toBe(true);
  });
});

describe('filterStaffRoleSlugs strips non-User principals from staff sessions', () => {
  it('drops external and candidate, keeps real staff roles', () => {
    expect(filterStaffRoleSlugs(['recruiter', 'external', 'employee', 'candidate'])).toEqual(['recruiter', 'employee']);
  });
  it('returns empty when only non-staff roles are present', () => {
    expect(filterStaffRoleSlugs(['external'])).toEqual([]);
  });
  it('is a no-op for a normal staff role set', () => {
    expect(filterStaffRoleSlugs(['hr_admin', 'leader'])).toEqual(['hr_admin', 'leader']);
  });
});

describe('staff session construction filters role slugs', () => {
  it('route.ts maps userRoles through filterStaffRoleSlugs', () => {
    const route = readFileSync(join(__dirname, '../../apps/web/app/api/trpc/[trpc]/route.ts'), 'utf8');
    const matches = route.match(/filterStaffRoleSlugs\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // realUser + impersonation target
  });
});
