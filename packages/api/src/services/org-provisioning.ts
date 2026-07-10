// Shared provisioning steps applied inside BOTH org-creation transactions:
// self-serve signup (apps/web/app/auth/callback/route.ts) and platform-owner
// provisioning (packages/api/src/routers/platform/organizations.ts's
// createOrganization). A brand-new org gets a usable default structure
// (Company/BusinessUnit/Team) and a starter entitlements bundle instead of an
// empty shell that needs manual setup before anything works.
//
// Callers must invoke both functions with the SAME `tx` used to create the
// `Organization` row, inside that same `$transaction` (.claude/rules/db.md —
// multi-step writes atomic), and only after `org.id` exists (FK dependency).
import type { Prisma } from '@tims/db';

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
export async function provisionOrgEntitlements(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<void> {
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
