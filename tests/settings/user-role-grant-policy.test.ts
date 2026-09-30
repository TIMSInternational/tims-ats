/**
 * Staff-role grant policy on the tRPC user router (PR #307 tier-3 panel, HIGH).
 *
 * `user.create` (user:create) and `user.assignRole` (user:update) accepted ANY ASSIGNABLE_STAFF_ROLES slug, so an
 * hr_admin could mint or promote a super_admin — the exact escalation the C# /tenant-invitations surface refuses
 * with InvitationGrantPolicy. Both procedures now enforce the same pure policy (canGrantStaffRole) BEFORE any
 * lookup, provisioning or write, and the denial is audited as `authz_denied` by the outermost withSecurityAudit.
 *
 * Harness mirrors tests/settings/user-list-cursor.test.ts: db + access shims and createCallerFactory. The
 * permission gate itself is mocked ALLOWED so the ONLY thing that can refuse is the grant policy.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  roleFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  userRoleUpsert: vi.fn(),
  txUserCreate: vi.fn(),
  txUserRoleCreate: vi.fn(),
  auditCreate: vi.fn(),
  provision: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  db: { auditLog: { create: (args: unknown) => h.auditCreate(args) } },
  Prisma: {},
  tenantDb: {
    role: { findFirst: (args: unknown) => h.roleFindFirst(args) },
    user: { findFirst: (args: unknown) => h.userFindFirst(args) },
    userRole: { upsert: (args: unknown) => h.userRoleUpsert(args) },
  },
  runTenantTransaction: (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({ user: { create: h.txUserCreate }, userRole: { create: h.txUserRoleCreate } }),
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

const allow = { allowed: true, scope: 'organization', roles: ['hr_admin'] };
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
vi.mock('../../packages/api/src/services/staff-provisioning.service', () => ({
  resolveStaffSupabaseUserId: (email: string) => h.provision(email),
}));
vi.mock('../../packages/api/src/lib/cache', () => ({
  invalidatePermissionCache: (orgId: string) => h.invalidate(orgId),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ACTOR_ID = 'b1ffcd00-0d1c-4f09-cc7e-7cc0ce491b22';
const TARGET_ID = 'c2aade11-1e2d-4a10-8d8f-8dd1df5a2c33';

async function makeCaller(roles: string[]) {
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

const newUser = (roleSlug: string) => ({ email: 'new@example.test', firstName: 'New', lastName: 'Hire', roleSlug });

// observeDenial is fire-and-forget; give its promise chain a turn to reach db.auditLog.create.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deniedAudits(path: string) {
  return h.auditCreate.mock.calls
    .map(([args]) => (args as { data: { action: string; entity: string; organizationId: string } }).data)
    .filter((d) => d.action === 'authz_denied' && d.entity === `trpc:${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.roleFindFirst.mockImplementation(({ where }: { where: { slug: string } }) =>
    Promise.resolve({ id: `role-${where.slug}`, slug: where.slug }),
  );
  h.userFindFirst.mockImplementation(({ where }: { where: { id?: string } }) =>
    Promise.resolve(where.id ? { id: where.id } : null),
  );
  h.userRoleUpsert.mockResolvedValue({ userId: TARGET_ID });
  h.txUserCreate.mockResolvedValue({ id: TARGET_ID });
  h.txUserRoleCreate.mockResolvedValue({});
  h.auditCreate.mockResolvedValue({});
  h.provision.mockResolvedValue('supabase-new');
  h.invalidate.mockResolvedValue(undefined);
});

describe('user.create enforces the staff-role grant policy', () => {
  it('hr_admin creating a super_admin is FORBIDDEN, nothing is provisioned or written, and it is audited', async () => {
    const caller = await makeCaller(['hr_admin']);
    await expect(caller.user.create(newUser('super_admin'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.roleFindFirst).not.toHaveBeenCalled();
    expect(h.provision).not.toHaveBeenCalled();
    expect(h.txUserCreate).not.toHaveBeenCalled();
    expect(h.txUserRoleCreate).not.toHaveBeenCalled();
    await flush();
    expect(deniedAudits('user.create')).toEqual([expect.objectContaining({ organizationId: ORG_ID })]);
  });

  it('recruiter (custom user:create grant) cannot create hr_admin', async () => {
    const caller = await makeCaller(['recruiter']);
    await expect(caller.user.create(newUser('hr_admin'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.txUserCreate).not.toHaveBeenCalled();
  });

  it('positive control: hr_admin creates an hr_admin (grantable) and the user + role are written', async () => {
    const caller = await makeCaller(['hr_admin']);
    await expect(caller.user.create(newUser('hr_admin'))).resolves.toEqual({ id: TARGET_ID });
    expect(h.txUserCreate).toHaveBeenCalledTimes(1);
    expect(h.txUserRoleCreate).toHaveBeenCalledWith({
      data: { userId: TARGET_ID, roleId: 'role-hr_admin', assignedBy: ACTOR_ID },
    });
  });

  it('positive control: super_admin creates a super_admin', async () => {
    const caller = await makeCaller(['super_admin']);
    await expect(caller.user.create(newUser('super_admin'))).resolves.toEqual({ id: TARGET_ID });
    expect(h.txUserRoleCreate).toHaveBeenCalledTimes(1);
  });

  it('positive control: a recruiter may still create the default employee role', async () => {
    const caller = await makeCaller(['recruiter']);
    await expect(caller.user.create(newUser('employee'))).resolves.toEqual({ id: TARGET_ID });
  });
});

describe('user.assignRole enforces the staff-role grant policy', () => {
  it('hr_admin assigning super_admin is FORBIDDEN, nothing is upserted or invalidated, and it is audited', async () => {
    const caller = await makeCaller(['hr_admin']);
    await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'super_admin' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(h.userFindFirst).not.toHaveBeenCalled();
    expect(h.userRoleUpsert).not.toHaveBeenCalled();
    expect(h.invalidate).not.toHaveBeenCalled();
    await flush();
    expect(deniedAudits('user.assignRole')).toEqual([expect.objectContaining({ organizationId: ORG_ID })]);
  });

  it('leader cannot assign hrbp (a role they do not hold)', async () => {
    const caller = await makeCaller(['leader']);
    await expect(caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'hrbp' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(h.userRoleUpsert).not.toHaveBeenCalled();
  });

  it('positive control: hr_admin assigns recruiter and the role is upserted', async () => {
    const caller = await makeCaller(['hr_admin']);
    await caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'recruiter' });
    expect(h.userRoleUpsert).toHaveBeenCalledTimes(1);
    expect(h.userRoleUpsert.mock.calls[0][0]).toMatchObject({
      where: { userId_roleId: { userId: TARGET_ID, roleId: 'role-recruiter' } },
    });
    expect(h.invalidate).toHaveBeenCalledWith(ORG_ID);
  });

  it('positive control: super_admin assigns super_admin', async () => {
    const caller = await makeCaller(['super_admin']);
    await caller.user.assignRole({ userId: TARGET_ID, roleSlug: 'super_admin' });
    expect(h.userRoleUpsert).toHaveBeenCalledTimes(1);
  });
});
