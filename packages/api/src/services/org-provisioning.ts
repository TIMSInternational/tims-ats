// Shared provisioning steps applied inside all org-creation transactions:
// self-serve signup, platform-owner provisioning, and organization invitations.
// A brand-new org gets a usable default structure
// (Company/BusinessUnit/Team) and a starter entitlements bundle instead of an
// empty shell that needs manual setup before anything works.
//
// Callers must invoke all three functions with the SAME `tx` used to create the
// `Organization` row, inside that same `$transaction` (.claude/rules/db.md —
// multi-step writes atomic), and only after `org.id` exists (FK dependency).
import type { Prisma } from '@tims/db';
import { MATRIX, SYSTEM_ROLE_CATALOG, flattenEntries } from '@tims/db';

export async function provisionOrgDefaults(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyName: string,
): Promise<{ companyId: string; businessUnitId: string; teamId: string }> {
  const company = await tx.company.create({
    data: { organizationId: orgId, name: companyName, country: 'CO' },
    select: { id: true },
  });

  const businessUnit = await tx.businessUnit.create({
    data: { organizationId: orgId, companyId: company.id, name: 'General' },
    select: { id: true },
  });

  const team = await tx.team.create({
    data: { organizationId: orgId, businessUnitId: businessUnit.id, name: 'Equipo General' },
    select: { id: true },
  });

  return { companyId: company.id, businessUnitId: businessUnit.id, teamId: team.id };
}

// Mirrors `provisionInvu`'s entitlement-granting pattern in
// packages/db/prisma/seed-entitlements.ts exactly, but with plain `create`
// instead of `upsert`: this runs once, inside a brand-new org's own creation
// transaction, so there is no pre-existing OrgEntitlement row to conflict
// with (unlike provisionInvu's idempotent re-seed case). Applies to every
// new org regardless of its legacy `OrgPlan` enum value (trial/starter/
// professional/enterprise) — same precedent as INVU (professional plan,
// still gets the full ats-base bundle). The `ats-base` PlanModule set
// excludes all `addon`-kind modules (ai_voice_interview, video_interviews,
// proctoring, custom_reports) by construction (see ATS_BASE_MODULES in
// seed-entitlements.ts), so iterating it here never grants an addon.
export async function provisionOrgEntitlements(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  const planModules = await tx.planModule.findMany({
    where: { planCode: 'ats-base' },
    select: { moduleCode: true, limit: true },
  });

  for (const pm of planModules) {
    await tx.orgEntitlement.create({
      data: {
        organizationId: orgId,
        moduleCode: pm.moduleCode,
        enabled: true,
        source: 'plan',
        limit: pm.limit,
      },
    });
  }
}

// A new tenant must have usable roles, not only a super_admin label with zero grants.
// Use the same matrix as the reconciliation seed so newly created tenants and seeded
// tenants receive the same scoped access. Call inside the org-creation transaction.
export async function provisionOrgRoles(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.role.createMany({
    data: SYSTEM_ROLE_CATALOG.map((role) => ({ ...role, organizationId: orgId, isSystem: true })),
    skipDuplicates: true,
  });
  const roles = await tx.role.findMany({
    where: { organizationId: orgId, slug: { in: SYSTEM_ROLE_CATALOG.map((role) => role.slug) } },
    select: { id: true, slug: true },
  });
  if (roles.length !== SYSTEM_ROLE_CATALOG.length) throw new Error('Tenant role provisioning incomplete');

  const grants = SYSTEM_ROLE_CATALOG.flatMap((role) =>
    flattenEntries(MATRIX[role.slug] ?? []).map((grant) => ({ roleSlug: role.slug, ...grant })),
  );
  const distinctPermissions = [
    ...new Map(
      grants.map((grant) => [
        `${grant.module}:${grant.action}`,
        { module: grant.module, action: grant.action, description: `${grant.module}.${grant.action}` },
      ]),
    ).values(),
  ];
  await tx.permission.createMany({ data: distinctPermissions, skipDuplicates: true });
  const permissions = await tx.permission.findMany({
    where: { OR: distinctPermissions.map((permission) => ({ module: permission.module, action: permission.action })) },
    select: { id: true, module: true, action: true },
  });
  if (permissions.length !== distinctPermissions.length) throw new Error('Tenant permission provisioning incomplete');
  const roleId = new Map(roles.map((role) => [role.slug, role.id]));
  const permissionId = new Map(
    permissions.map((permission) => [`${permission.module}:${permission.action}`, permission.id]),
  );
  await tx.rolePermission.createMany({
    data: grants.map((grant) => ({
      roleId: roleId.get(grant.roleSlug)!,
      permissionId: permissionId.get(`${grant.module}:${grant.action}`)!,
      scope: grant.scope,
    })),
    skipDuplicates: true,
  });
}
