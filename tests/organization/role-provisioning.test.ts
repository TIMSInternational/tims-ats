import { describe, expect, it, vi } from 'vitest';
import { MATRIX, SYSTEM_ROLE_CATALOG, flattenEntries } from '../../packages/db/prisma/seed-access-matrix';
import embedded from '../../services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/role-grants.json';
import { provisionOrgRoles } from '../../packages/api/src/services/org-provisioning';

const orgId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('organization role provisioning', () => {
  it('keeps the embedded .NET 10 contract identical to the TypeScript access matrix', () => {
    expect(embedded.roles).toEqual(
      SYSTEM_ROLE_CATALOG.map((role) => ({
        ...role,
        grants: flattenEntries(MATRIX[role.slug] ?? []),
      })),
    );
  });

  it('creates staff roles and scoped grants in the organization transaction', async () => {
    const roles = SYSTEM_ROLE_CATALOG.map((role, index) => ({ slug: role.slug, id: `role-${index}` }));
    const role = { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue(roles) };
    const permission = {
      createMany: vi.fn(),
      findMany: vi.fn().mockImplementation(async ({ where }) =>
        where.OR.map(({ module, action }: { module: string; action: string }, index: number) => ({
          id: `permission-${index}`,
          module,
          action,
        })),
      ),
    };
    const rolePermission = { createMany: vi.fn() };

    await provisionOrgRoles({ role, permission, rolePermission } as never, orgId);

    expect(role.createMany).toHaveBeenCalledWith({
      data: SYSTEM_ROLE_CATALOG.map((entry) => ({ ...entry, organizationId: orgId, isSystem: true })),
      skipDuplicates: true,
    });
    expect(role.findMany).toHaveBeenCalledWith({
      where: { organizationId: orgId, slug: { in: SYSTEM_ROLE_CATALOG.map((entry) => entry.slug) } },
      select: { id: true, slug: true },
    });
    const grants = rolePermission.createMany.mock.calls[0]?.[0].data as Array<{
      roleId: string;
      permissionId: string;
      scope: string;
    }>;
    expect(grants).toHaveLength(
      SYSTEM_ROLE_CATALOG.reduce((sum, entry) => sum + flattenEntries(MATRIX[entry.slug] ?? []).length, 0),
    );
    expect(grants).toContainEqual(expect.objectContaining({ roleId: roles[6].id, scope: 'own' }));
    expect(grants).not.toContainEqual(expect.objectContaining({ roleId: roles[8].id }));
    expect(permission.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });
});
