/**
 * Tenant member administration — company-admin access-3 / journeys-19 / spec-43 / ideal-78.
 *
 * The /settings/users members table now shows each member's role and offers "Cambiar rol" / "Desactivar".
 * Server side, user.assignRole now REPLACES the role (it could only add one) and user.deactivate gained
 * the guards it never had: never the caller, never a platform owner, never someone above the caller, never
 * the last active super_admin — plus a permission-cache flush and a security event, like assignRole.
 *
 * Harness mirrors tests/settings/user-role-grant-policy.test.ts: db + access shims and createCallerFactory,
 * the permission gate mocked ALLOWED so only the member policy can refuse.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memberChangeRefusal, removesSuperAdmin } from '../../packages/api/src/services/member-admin.policy';
import { canManageMember, memberRoleOptions, primaryRoleSlug } from '../../apps/web/lib/member-admin';
import es from '../../apps/web/lib/i18n/es.json';

const h = vi.hoisted(() => ({
  findTarget: vi.fn(),
  countSuperAdmins: vi.fn(),
  findRole: vi.fn(),
  deleteRoles: vi.fn(),
  createRole: vi.fn(),
  updateUser: vi.fn(),
  auditCreate: vi.fn(),
  invalidate: vi.fn(),
  lock: vi.fn(),
  order: [] as string[],
  findActor: vi.fn(),
  actorRoles: [] as string[],
}));

vi.mock('@tims/db', () => ({
  db: { auditLog: { create: (args: unknown) => h.auditCreate(args) } },
  Prisma: {},
  tenantDb: {},
  runTenantTransaction: (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        h.order.push('lock');
        return h.lock(strings.join('?'), ...values);
      },
      user: {
        // The caller's own row (re-read under the lock) selects no isPlatformOwner; the target's does.
        findFirst: (args: unknown) => {
          const select = (args as { select?: Record<string, unknown> }).select ?? {};
          if (!('isPlatformOwner' in select)) return h.order.push('actor'), h.findActor(args);
          return h.order.push('read'), h.findTarget(args);
        },
        count: (args: unknown) => h.countSuperAdmins(args),
        update: (args: unknown) => h.updateUser(args),
      },
      role: { findFirst: (args: unknown) => h.findRole(args) },
      userRole: { deleteMany: (args: unknown) => h.deleteRoles(args), create: (args: unknown) => h.createRole(args) },
      // The caller's user:<action> permission is re-resolved from their re-read roles under the lock. The seeded
      // matrix grants user:update/delete to super_admin and hr_admin only.
      rolePermission: {
        findMany: (args: unknown) => {
          const where = (args as { where: { role: { slug: { in: string[] } }; permission: { module: string; action: string } } }).where;
          return Promise.resolve(
            where.role.slug.in
              .filter((slug) => slug === 'super_admin' || slug === 'hr_admin')
              .map((slug) => ({ scope: 'organization', role: { slug }, permission: where.permission })),
          );
        },
      },
    }),
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

const allow = { allowed: true, scope: 'organization', roles: ['super_admin'] };
vi.mock('../../packages/api/src/access/build', () => ({ buildAccessForUser: vi.fn().mockResolvedValue(allow) }));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: vi.fn().mockReturnValue(null) }));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue(allow),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));
vi.mock('../../packages/api/src/services/staff-provisioning.service', () => ({ resolveStaffSupabaseUserId: vi.fn() }));
vi.mock('../../packages/api/src/lib/cache', () => ({
  invalidatePermissionCache: (orgId: string) => h.invalidate(orgId),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ACTOR_ID = 'b1ffcd00-0d1c-4f09-8c7e-7cc0ce491b22';
const TARGET_ID = 'c2aade11-1e2d-4a10-8d8f-8dd1df5a2c33';

async function makeCaller(roles: string[]) {
  h.actorRoles = roles;
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { userRouter } = await import('../../packages/api/src/routers/user');
  const ctx = {
    user: { id: ACTOR_ID, organizationId: ORG_ID, roles, isPlatformOwner: false, email: 'actor@example.test' },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  };
  return createCallerFactory(router({ user: userRouter }))(ctx as never);
}

const target = (roles: string[], extra: Record<string, unknown> = {}) => ({
  id: TARGET_ID,
  isPlatformOwner: false,
  userRoles: roles.map((slug) => ({ role: { slug } })),
  ...extra,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const auditActions = () => h.auditCreate.mock.calls.map(([a]) => (a as { data: { action: string } }).data.action);

beforeEach(() => {
  vi.clearAllMocks();
  h.order = [];
  h.findActor.mockImplementation(() => Promise.resolve({ userRoles: h.actorRoles.map((slug) => ({ role: { slug } })) }));
  h.findRole.mockResolvedValue({ id: 'role-id' });
  h.countSuperAdmins.mockResolvedValue(1);
  h.updateUser.mockResolvedValue({ id: TARGET_ID, isActive: false });
});

describe('memberChangeRefusal (pure policy)', () => {
  const base = { actorId: ACTOR_ID, actorRoles: ['super_admin'], otherActiveSuperAdmins: 1 };
  it('refuses the caller acting on themselves, and platform owners', () => {
    expect(
      memberChangeRefusal({ ...base, target: { id: ACTOR_ID, isPlatformOwner: false, roleSlugs: ['recruiter'] } }),
    ).toBe('self');
    expect(memberChangeRefusal({ ...base, target: { id: TARGET_ID, isPlatformOwner: true, roleSlugs: [] } })).toBe(
      'platform_owner',
    );
  });
  it('an hr_admin cannot touch a super_admin nor grant super_admin', () => {
    const hr = { ...base, actorRoles: ['hr_admin'] };
    expect(
      memberChangeRefusal({ ...hr, target: { id: TARGET_ID, isPlatformOwner: false, roleSlugs: ['super_admin'] } }),
    ).toBe('target_above_caller');
    expect(
      memberChangeRefusal({
        ...hr,
        target: { id: TARGET_ID, isPlatformOwner: false, roleSlugs: ['recruiter'] },
        newRole: 'super_admin',
      }),
    ).toBe('role_not_grantable');
    expect(
      memberChangeRefusal({
        ...hr,
        target: { id: TARGET_ID, isPlatformOwner: false, roleSlugs: ['recruiter'] },
        newRole: 'committee',
      }),
    ).toBeNull();
  });
  it('never removes the last active super_admin, by demotion or deactivation', () => {
    const lastAdmin = { id: TARGET_ID, isPlatformOwner: false, roleSlugs: ['super_admin'] };
    expect(memberChangeRefusal({ ...base, otherActiveSuperAdmins: 0, target: lastAdmin, newRole: 'recruiter' })).toBe(
      'last_super_admin',
    );
    expect(memberChangeRefusal({ ...base, otherActiveSuperAdmins: 0, target: lastAdmin })).toBe('last_super_admin');
    expect(
      memberChangeRefusal({ ...base, otherActiveSuperAdmins: 0, target: lastAdmin, newRole: 'super_admin' }),
    ).toBeNull();
    expect(
      memberChangeRefusal({ ...base, otherActiveSuperAdmins: 1, target: lastAdmin, newRole: 'recruiter' }),
    ).toBeNull();
    expect(removesSuperAdmin(['recruiter'])).toBe(false);
  });
});

describe('user.assignRole (now replaces the role)', () => {
  it('replaces every role with the new one, flushes the permission cache and audits from/to', async () => {
    h.findTarget.mockResolvedValue(target(['recruiter', 'committee']));
    const caller = await makeCaller(['super_admin']);
    await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'hr_admin' })).resolves.toEqual({ success: true });
    expect(h.deleteRoles).toHaveBeenCalledWith({ where: { userId: TARGET_ID, role: { organizationId: ORG_ID } } });
    expect(h.createRole).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: TARGET_ID, roleId: 'role-id', assignedBy: ACTOR_ID } }),
    );
    expect(h.invalidate).toHaveBeenCalledWith(ORG_ID);
    await flush();
    const row = h.auditCreate.mock.calls
      .map(([a]) => (a as { data: Record<string, unknown> }).data)
      .find((d) => d.action === 'role_assigned');
    expect(row).toMatchObject({ organizationId: ORG_ID, actorId: ACTOR_ID, entityId: TARGET_ID });
    expect(row?.metadata).toMatchObject({ previousRoles: ['recruiter', 'committee'], roleSlug: 'hr_admin' });
  });

  it('refuses demoting the last active super_admin and writes nothing', async () => {
    h.findTarget.mockResolvedValue(target(['super_admin']));
    h.countSuperAdmins.mockResolvedValue(0);
    const caller = await makeCaller(['super_admin']);
    await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'recruiter' })).rejects.toThrow(
      /al menos un Super Administrador/,
    );
    expect(h.deleteRoles).not.toHaveBeenCalled();
    expect(h.createRole).not.toHaveBeenCalled();
  });

  it('refuses an hr_admin demoting a super_admin', async () => {
    h.findTarget.mockResolvedValue(target(['super_admin']));
    const caller = await makeCaller(['hr_admin']);
    await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'recruiter' })).rejects.toThrow(
      /rol superior al tuyo/,
    );
    expect(h.deleteRoles).not.toHaveBeenCalled();
  });

  it('refuses the caller changing their own role', async () => {
    h.findTarget.mockResolvedValue({ ...target(['super_admin']), id: ACTOR_ID });
    const caller = await makeCaller(['super_admin']);
    await expect(caller.user.assignRole({ userId: ACTOR_ID, roleSlug: 'recruiter' })).rejects.toThrow(/propio rol/);
    expect(h.deleteRoles).not.toHaveBeenCalled();
  });

  it('a member of another organization (or a deactivated one) is not found', async () => {
    h.findTarget.mockResolvedValue(null);
    const caller = await makeCaller(['super_admin']);
    await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'recruiter' })).rejects.toThrow(/no encontrado/);
    expect(h.findTarget).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID, organizationId: ORG_ID, isActive: true, deletedAt: null } }),
    );
  });
});

describe('per-organization serialization (Codex P1: concurrent admins)', () => {
  it('assignRole and deactivate take the organization member-admin lock before reading anything', async () => {
    h.findTarget.mockResolvedValue(target(['recruiter']));
    const caller = await makeCaller(['super_admin']);
    await caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'committee' });
    await caller.user.deactivate({ userId: TARGET_ID });
    expect(h.order.slice(0, 3)).toEqual(['lock', 'actor', 'read']);
    expect(h.order.filter((o) => o === 'lock')).toHaveLength(2);
    for (const call of h.lock.mock.calls) {
      expect(call[0]).toContain('pg_advisory_xact_lock');
      expect(call[1]).toBe(`member-admin:${ORG_ID}`);
    }
  });
});

describe('the caller is re-checked under the lock (Codex round 2: stale privileges)', () => {
  it('an admin demoted meanwhile cannot act with the privileges in their session', async () => {
    const caller = await makeCaller(['super_admin']);
    h.actorRoles = ['employee']; // demoted by a request that held the lock first
    h.findTarget.mockResolvedValue(target(['recruiter']));
    // The re-read roles no longer grant user:update / user:delete, so the request is refused before the
    // hierarchy policy runs.
    await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'committee' })).rejects.toThrow(/ya no puede administrar/);
    await expect(caller.user.deactivate({ userId: TARGET_ID })).rejects.toThrow(/ya no puede administrar/);
    expect(h.deleteRoles).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  // Codex review of release/pilot-ux-wave2 (P1): the hierarchy policy alone lets almost any role (even none)
  // act on an `employee`, so a demotion that committed while this request waited let it deactivate one.
  it.each([[['employee']], [['recruiter']], [[]]])(
    'a caller demoted to %j meanwhile cannot deactivate an employee or change their role',
    async (demotedTo) => {
      const caller = await makeCaller(['hr_admin']);
      h.actorRoles = demotedTo;
      h.findTarget.mockResolvedValue(target(['employee']));
      await expect(caller.user.deactivate({ userId: TARGET_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'employee' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(h.updateUser).not.toHaveBeenCalled();
      expect(h.deleteRoles).not.toHaveBeenCalled();
    },
  );

  it('an admin deactivated meanwhile is refused', async () => {
    const caller = await makeCaller(['super_admin']);
    h.findActor.mockResolvedValue(null);
    h.findTarget.mockResolvedValue(target(['recruiter']));
    await expect(caller.user.deactivate({ userId: TARGET_ID })).rejects.toThrow(/ya no puede administrar/);
    expect(h.updateUser).not.toHaveBeenCalled();
  });
});

describe('user.deactivate', () => {
  it('deactivates, flushes the cache, audits, and returns only id/isActive', async () => {
    h.findTarget.mockResolvedValue(target(['recruiter']));
    const caller = await makeCaller(['super_admin']);
    await expect(caller.user.deactivate({ userId: TARGET_ID })).resolves.toEqual({ id: TARGET_ID, isActive: false });
    expect(h.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET_ID }, select: { id: true, isActive: true } }),
    );
    expect(h.invalidate).toHaveBeenCalledWith(ORG_ID);
    await flush();
    expect(auditActions()).toContain('user_deactivated');
  });

  it('refuses the caller, a super_admin for an hr_admin, and the last active super_admin', async () => {
    h.findTarget.mockResolvedValue({ ...target(['super_admin']), id: ACTOR_ID });
    await expect((await makeCaller(['super_admin'])).user.deactivate({ userId: ACTOR_ID })).rejects.toThrow(
      /propia cuenta/,
    );

    h.findTarget.mockResolvedValue(target(['super_admin']));
    await expect((await makeCaller(['hr_admin'])).user.deactivate({ userId: TARGET_ID })).rejects.toThrow(
      /rol superior/,
    );

    h.countSuperAdmins.mockResolvedValue(0);
    await expect((await makeCaller(['super_admin'])).user.deactivate({ userId: TARGET_ID })).rejects.toThrow(
      /al menos un Super Administrador/,
    );
    expect(h.updateUser).not.toHaveBeenCalled();
  });
});

describe('members table helpers (web)', () => {
  it('shows the most privileged role and hides actions on self and on members above the admin', () => {
    expect(primaryRoleSlug(['committee', 'recruiter'])).toBe('recruiter');
    expect(primaryRoleSlug([])).toBeNull();
    expect(
      canManageMember({ id: ACTOR_ID, roles: ['super_admin'] }, { id: ACTOR_ID, roleSlugs: ['super_admin'] }),
    ).toBe(false);
    expect(canManageMember({ id: ACTOR_ID, roles: ['hr_admin'] }, { id: TARGET_ID, roleSlugs: ['super_admin'] })).toBe(
      false,
    );
    expect(canManageMember({ id: ACTOR_ID, roles: ['hr_admin'] }, { id: TARGET_ID, roleSlugs: ['recruiter'] })).toBe(
      true,
    );
    expect(canManageMember({ id: null, roles: ['super_admin'] }, { id: TARGET_ID, roleSlugs: ['recruiter'] })).toBe(
      false,
    );
  });

  it('offers only grantable roles, without hrbp/leader in the pilot, labelled in Spanish', () => {
    const pilot = memberRoleOptions(['super_admin'], es.roles, 'recruiter', 'pilot');
    expect(pilot.map((o) => o.slug)).toEqual(['super_admin', 'hr_admin', 'recruiter', 'committee', 'employee']);
    expect(pilot.find((o) => o.slug === 'committee')?.label).toBe('Comité de entrevista');
    const hr = memberRoleOptions(['hr_admin'], es.roles, 'recruiter', 'full');
    expect(hr.map((o) => o.slug)).not.toContain('super_admin');
  });
});
