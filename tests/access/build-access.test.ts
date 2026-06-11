import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
}));
vi.mock('@tims/db', () => ({
  db: { rolePermission: { findMany: vi.fn() } },
  tenantDb: {},
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

import { buildAccessForUser } from '../../packages/api/src/access/build';
import { db } from '@tims/db';
import { cacheGet, cacheSet } from '../../packages/api/src/lib/cache';

beforeEach(() => vi.clearAllMocks());

const row = (role: string, module: string, action: string, scope: string) =>
  ({ scope, role: { slug: role }, permission: { module, action } }) as never;

describe('buildAccessForUser', () => {
  it('privileged super_admin → explicit org-scope decision, NEVER undefined, no DB hit', async () => {
    const access = await buildAccessForUser(
      { id: 'u', organizationId: 'o', roles: ['super_admin'], isPlatformOwner: false },
      'compensation', 'read',
    );
    expect(access).toEqual({ allowed: true, scope: 'organization', roles: ['super_admin'] });
    expect(db.rolePermission.findMany).not.toHaveBeenCalled();
  });

  it('platform owner WITHOUT org context on a tenant module → throws BAD_REQUEST (never unscoped)', async () => {
    await expect(
      buildAccessForUser(
        { id: 'u', organizationId: null, roles: [], isPlatformOwner: true },
        'candidate', 'read',
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('platform owner with own org row → org-scope decision', async () => {
    expect(
      await buildAccessForUser(
        { id: 'u', organizationId: 'o', roles: [], isPlatformOwner: true },
        'candidate', 'read',
      ),
    ).toEqual({ allowed: true, scope: 'organization', roles: ['platform_owner'] });
  });

  it('hr_admin is DB-checked now: audit read with no seeded grant → {allowed:false}', async () => {
    vi.mocked(db.rolePermission.findMany).mockResolvedValue([] as never);
    const access = await buildAccessForUser(
      { id: 'u', organizationId: 'o', roles: ['hr_admin'], isPlatformOwner: false },
      'audit', 'read',
    );
    expect(access).toEqual({ allowed: false });
  });

  it('hr_admin with seeded grant → allowed at the seeded scope', async () => {
    vi.mocked(db.rolePermission.findMany).mockResolvedValue([
      row('hr_admin', 'candidate', 'read', 'organization'),
    ] as never);
    expect(
      await buildAccessForUser(
        { id: 'u', organizationId: 'o', roles: ['hr_admin'], isPlatformOwner: false },
        'candidate', 'read',
      ),
    ).toEqual({ allowed: true, scope: 'organization', roles: ['hr_admin'] });
  });

  it('legacy scope all maps to organization (pre-seed compat)', async () => {
    vi.mocked(db.rolePermission.findMany).mockResolvedValue([
      row('recruiter', 'candidate', 'read', 'all'),
    ] as never);
    expect(
      await buildAccessForUser(
        { id: 'u', organizationId: 'o', roles: ['recruiter'], isPlatformOwner: false },
        'candidate', 'read',
      ),
    ).toEqual({ allowed: true, scope: 'organization', roles: ['recruiter'] });
  });

  it('multi-role stacking flows through (employee+leader)', async () => {
    vi.mocked(db.rolePermission.findMany).mockResolvedValue([
      row('employee', 'performance', 'read', 'own'),
      row('leader', 'performance', 'read', 'team'),
    ] as never);
    expect(
      await buildAccessForUser(
        { id: 'u', organizationId: 'o', roles: ['employee', 'leader'], isPlatformOwner: false },
        'performance', 'read',
      ),
    ).toEqual({ allowed: true, scope: 'team', roles: ['employee', 'leader'] });
  });

  it('caches the decision (key includes org, sorted roles, module, action) and serves from cache', async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce({ allowed: false } as never);
    const access = await buildAccessForUser(
      { id: 'u', organizationId: 'o', roles: ['employee'], isPlatformOwner: false },
      'billing', 'read',
    );
    expect(access).toEqual({ allowed: false });
    expect(db.rolePermission.findMany).not.toHaveBeenCalled();
    expect(vi.mocked(cacheGet).mock.calls[0][0]).toBe('tims:access:o:employee:billing:read');
  });

  it('user with no org and not privileged → {allowed:false}', async () => {
    expect(
      await buildAccessForUser(
        { id: 'u', organizationId: null, roles: ['employee'], isPlatformOwner: false },
        'performance', 'read',
      ),
    ).toEqual({ allowed: false });
  });
});
