/**
 * packages/db/prisma/grant-dei-hr-admin.ts
 *
 * Targeted, additive-only fix for a single gap found during the C# DEI cutover
 * parity verify (2026-07-27): hr_admin is missing the `dei:read`/`dei:export`
 * grants that `seed-access-matrix.ts`'s MATRIX already declares it should have
 * (hr_admin: [{ module: 'dei', actions: ['read', 'export'], scope: 'organization' }]).
 *
 * Deliberately NOT the full `seed-access.ts` reconciler: that script's own header
 * warns it "MUST NOT be applied to prod until the Wave 2.5 scope-enforcement
 * slices deploy" because it also DELETES/UPDATES grants across every role and
 * module to match the current MATRIX — a much larger blast radius than this one
 * missing grant. This script only ever CREATES the two specific hr_admin/dei
 * RolePermission rows that are missing; it never touches any other role, module,
 * or existing grant, and is safe to run against prod independent of Wave 2.5.
 *
 * Usage:
 *   pnpm --filter @tims/db exec tsx prisma/grant-dei-hr-admin.ts           # DRY-RUN (default)
 *   pnpm --filter @tims/db exec tsx prisma/grant-dei-hr-admin.ts --apply   # write to DB
 */

import { PrismaClient } from '@prisma/client';
import { grantsFor } from './seed-access-matrix';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ROLE_SLUG = 'hr_admin';
const MODULE = 'dei';

async function main() {
  const targetTriples = grantsFor(ROLE_SLUG).filter((t) => t.module === MODULE);
  if (targetTriples.length === 0) {
    throw new Error(
      `No ${MODULE} grants found for ${ROLE_SLUG} in MATRIX — nothing to apply, check seed-access-matrix.ts`,
    );
  }

  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(
    `Target: role=${ROLE_SLUG} module=${MODULE}, triples=${targetTriples.map((t) => `${t.module}:${t.action}@${t.scope}`).join(', ')}\n`,
  );

  const orgs = await db.organization.findMany({ select: { id: true, name: true, slug: true } });
  console.log(`Found ${orgs.length} organization(s): ${orgs.map((o) => o.slug).join(', ')}\n`);

  let totalCreates = 0;
  let totalAlreadyPresent = 0;
  let totalMissingRole = 0;

  for (const org of orgs) {
    const role = await db.role.findUnique({
      where: { organizationId_slug: { organizationId: org.id, slug: ROLE_SLUG } },
      select: { id: true },
    });

    if (!role) {
      console.log(
        `  [${org.slug}] role "${ROLE_SLUG}" does not exist — skipping (not this script's job to create roles)`,
      );
      totalMissingRole++;
      continue;
    }

    const existing = await db.rolePermission.findMany({
      where: { roleId: role.id, permission: { module: MODULE } },
      select: { scope: true, permission: { select: { action: true } } },
    });
    const existingActions = new Set(existing.map((rp) => rp.permission.action));

    const toCreate = targetTriples.filter((t) => !existingActions.has(t.action));
    if (toCreate.length === 0) {
      console.log(`  [${org.slug}] already has all ${MODULE} grants for ${ROLE_SLUG} — no-op`);
      totalAlreadyPresent += targetTriples.length;
      continue;
    }

    console.log(
      `  [${org.slug}] CREATE ${toCreate.length}: ${toCreate.map((t) => `${t.module}:${t.action}@${t.scope}`).join(', ')}`,
    );
    totalCreates += toCreate.length;

    if (!APPLY) continue;

    for (const triple of toCreate) {
      const perm = await db.permission.upsert({
        where: { module_action: { module: triple.module, action: triple.action } },
        update: {},
        create: { module: triple.module, action: triple.action, description: `${triple.module}.${triple.action}` },
        select: { id: true },
      });
      await db.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id, scope: triple.scope },
      });
    }

    console.log(`  [${org.slug}] applied (creates=${toCreate.length})`);
  }

  console.log(
    `\nmode=${APPLY ? 'APPLY' : 'DRY-RUN'} orgs=${orgs.length} creates=${totalCreates} already-present=${totalAlreadyPresent} missing-role=${totalMissingRole}`,
  );

  if (APPLY) {
    console.log(
      'WARNING: flush the decision cache now (tims:access:* / tims:perm:* in Upstash) or stale grants persist up to 300s.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
