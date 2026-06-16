/**
 * packages/db/prisma/seed-access.ts
 *
 * Reconciling seed for the 9-role scoped permission matrix (Wave 2.5).
 *
 * Usage:
 *   pnpm --filter @tims/db exec tsx prisma/seed-access.ts           # DRY-RUN (default)
 *   pnpm --filter @tims/db exec tsx prisma/seed-access.ts --apply   # write to DB
 *
 * DEPLOY-ORDERING WARNING:
 *   MUST NOT be applied to prod until the Wave 2.5 scope-enforcement slices deploy —
 *   under scope-ignorant middleware, own/team grants behave org-wide (fail-open).
 *   Apply order at wave deploy: migration → this seed --apply → code.
 *   After --apply, flush tims:access:* / tims:perm:* (or accept 300s staleness).
 *
 * Reconciliation contract:
 *   For each of the 9 system-role slugs, grants present in the DB but NOT in this
 *   matrix are DELETED. This removes stale rows from old seeding (e.g. recruiter
 *   currently holds vacancy:approve/publish + offer:create/update/delete/approve
 *   from seed-users.ts — the new matrix removes them). Dry-run prints planned
 *   creates/updates/deletes per org+role without touching the DB.
 */

import { PrismaClient } from '@prisma/client';
import { MATRIX, flattenEntries, type Scope, type Triple } from './seed-access-matrix';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// ---------------------------------------------------------------------------
// SYSTEM_ROLES — names/descriptions copied from seed.ts.
// Name/description of existing roles are deliberately NOT reconciled here
// (grants only): renaming a role is a separate intentional migration.
// ---------------------------------------------------------------------------
const SYSTEM_ROLES: Array<{ slug: string; name: string; description: string }> = [
  { slug: 'super_admin',  name: 'Super Administrador',  description: 'Full access to all modules' },
  { slug: 'hr_admin',     name: 'Administrador RRHH',   description: 'Full access to all HR modules' },
  { slug: 'hrbp',         name: 'HR Business Partner',  description: 'Access to assigned business units' },
  { slug: 'recruiter',    name: 'Reclutador',            description: 'ATS modules only' },
  { slug: 'leader',       name: 'Lider',                 description: 'Own team and assigned vacancies' },
  { slug: 'committee',    name: 'Miembro de Comite',     description: 'Review panels only' },
  { slug: 'employee',     name: 'Colaborador',           description: 'Self-service access' },
  { slug: 'external',     name: 'API Externa',           description: 'API access for integrations' },
  { slug: 'candidate',    name: 'Candidato',             description: 'Portal access only' },
];

// ---------------------------------------------------------------------------
// Build a global Permission map (module:action → permissionId) by upserting
// each distinct module:action from the entire MATRIX once, before the org loop.
// ---------------------------------------------------------------------------
async function buildPermissionMap(): Promise<Map<string, string>> {
  const allTriples: Triple[] = Object.values(MATRIX).flatMap(flattenEntries);
  const distinct = new Map<string, Triple>();
  for (const t of allTriples) {
    const key = `${t.module}:${t.action}`;
    if (!distinct.has(key)) distinct.set(key, t);
  }

  const permMap = new Map<string, string>();

  if (APPLY) {
    for (const [key, t] of distinct.entries()) {
      const perm = await db.permission.upsert({
        where: { module_action: { module: t.module, action: t.action } },
        update: {},
        create: {
          module: t.module,
          action: t.action,
          description: `${t.module}.${t.action}`,
        },
        select: { id: true },
      });
      permMap.set(key, perm.id);
    }
  } else {
    // Dry-run: fetch existing permissions to map known ids (new ones get placeholder)
    const existing = await db.permission.findMany({
      where: {
        OR: [...distinct.keys()].map((k) => {
          const [module, action] = k.split(':') as [string, string];
          return { module, action };
        }),
      },
      select: { id: true, module: true, action: true },
    });
    for (const p of existing) {
      permMap.set(`${p.module}:${p.action}`, p.id);
    }
    // Unmapped keys get a placeholder; creates are tracked by count not actual id in dry-run
    for (const key of distinct.keys()) {
      if (!permMap.has(key)) permMap.set(key, `__new__:${key}`);
    }
  }

  return permMap;
}

// ---------------------------------------------------------------------------
// Run-level accumulators for the review blocks (I1)
// ---------------------------------------------------------------------------
type DeleteAccum  = { key: string; scope: string; role: string; orgCount: number; orgSlugs: string[] };
type UpdateAccum  = { key: string; oldScope: string; newScope: string; role: string; orgCount: number; orgSlugs: string[] };

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('Reconciling scoped permission matrix across all organizations...\n');

  const orgs = await db.organization.findMany({ select: { id: true, name: true, slug: true } });
  console.log(`Found ${orgs.length} organization(s): ${orgs.map((o) => o.slug).join(', ')}\n`);

  // Hoist permission upserts (I2)
  const permMap = await buildPermissionMap();

  let totalCreates = 0;
  let totalUpdates = 0;
  let totalDeletes = 0;

  // Run-level accumulators for review blocks (I1)
  // Key: `role::module:action::oldScope::newScope` for updates, `role::module:action::scope` for deletes
  const deleteAccum  = new Map<string, DeleteAccum>();
  const updateAccum  = new Map<string, UpdateAccum>();

  for (const org of orgs) {
    console.log(`--- Org: ${org.name} (${org.slug}) ---`);

    for (const systemRole of SYSTEM_ROLES) {
      const matrixEntries = MATRIX[systemRole.slug] ?? [];
      const matrixTriples = flattenEntries(matrixEntries);

      // Build a lookup: "module:action" → scope
      const matrixMap = new Map<string, Scope>();
      for (const t of matrixTriples) {
        matrixMap.set(`${t.module}:${t.action}`, t.scope);
      }

      // 1. Upsert the Role row for this org+slug
      let role = await db.role.findUnique({
        where: { organizationId_slug: { organizationId: org.id, slug: systemRole.slug } },
        select: { id: true },
      });

      if (!role) {
        if (APPLY) {
          role = await db.role.create({
            data: {
              organizationId: org.id,
              slug: systemRole.slug,
              name: systemRole.name,
              description: systemRole.description,
              isSystem: true,
            },
            select: { id: true },
          });
          console.log(`  [${systemRole.slug}] Role created`);
        } else {
          console.log(`  [${systemRole.slug}] Role does not exist — would create`);
          // For dry-run accounting: all matrix triples would be creates
          totalCreates += matrixTriples.length;
          continue;
        }
      }

      const roleId = role.id;

      // 2. Load existing RolePermission rows for this role
      const existing = await db.rolePermission.findMany({
        where: { roleId },
        select: {
          id: true,
          scope: true,
          permission: { select: { module: true, action: true } },
        },
      });

      // Build a lookup: "module:action" → { id, scope }
      const existingMap = new Map<string, { id: string; scope: string }>();
      for (const rp of existing) {
        const key = `${rp.permission.module}:${rp.permission.action}`;
        existingMap.set(key, { id: rp.id, scope: rp.scope });
      }

      // 3. Compute diff
      const toCreate: Triple[] = [];
      const toUpdate: Array<{ id: string; key: string; oldScope: string; newScope: Scope }> = [];
      const toDelete: Array<{ id: string; key: string; scope: string }> = [];

      // Creates + scope-updates: keys in matrix
      for (const [key, newScope] of matrixMap.entries()) {
        const exRow = existingMap.get(key);
        if (!exRow) {
          const [module, action] = key.split(':') as [string, string];
          toCreate.push({ module, action, scope: newScope });
        } else if (exRow.scope !== newScope) {
          toUpdate.push({ id: exRow.id, key, oldScope: exRow.scope, newScope });
        }
      }

      // Deletes: keys in DB but not in matrix
      for (const [key, exRow] of existingMap.entries()) {
        if (!matrixMap.has(key)) {
          toDelete.push({ id: exRow.id, key, scope: exRow.scope });
        }
      }

      if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
        console.log(`  [${systemRole.slug}] up-to-date (${existing.length} grants)`);
        continue;
      }

      // 4. Print plan (I1: truncate CREATE listings to count + first 5 triples)
      if (toCreate.length > 0) {
        const triples = toCreate.map((t) => `${t.module}:${t.action}@${t.scope}`);
        const preview = triples.length > 5 ? triples.slice(0, 5).join(', ') + ', …' : triples.join(', ');
        console.log(`  [${systemRole.slug}] CREATE ${toCreate.length}: ${preview}`);
      }
      if (toUpdate.length > 0) {
        console.log(`  [${systemRole.slug}] UPDATE ${toUpdate.length}: ${toUpdate.map((u) => `${u.key} ${u.oldScope}→${u.newScope}`).join(', ')}`);
      }
      if (toDelete.length > 0) {
        console.log(`  [${systemRole.slug}] DELETE ${toDelete.length}: ${toDelete.map((d) => `${d.key}@${d.scope}`).join(', ')}`);
      }

      totalCreates += toCreate.length;
      totalUpdates += toUpdate.length;
      totalDeletes += toDelete.length;

      // Accumulate into run-level review blocks (I1)
      for (const d of toDelete) {
        const accumKey = `${systemRole.slug}::${d.key}::${d.scope}`;
        const entry = deleteAccum.get(accumKey);
        if (entry) {
          entry.orgCount++;
          entry.orgSlugs.push(org.slug);
        } else {
          deleteAccum.set(accumKey, { key: d.key, scope: d.scope, role: systemRole.slug, orgCount: 1, orgSlugs: [org.slug] });
        }
      }
      for (const u of toUpdate) {
        const accumKey = `${systemRole.slug}::${u.key}::${u.oldScope}::${u.newScope}`;
        const entry = updateAccum.get(accumKey);
        if (entry) {
          entry.orgCount++;
          entry.orgSlugs.push(org.slug);
        } else {
          updateAccum.set(accumKey, { key: u.key, oldScope: u.oldScope, newScope: u.newScope, role: systemRole.slug, orgCount: 1, orgSlugs: [org.slug] });
        }
      }

      if (!APPLY) continue;

      // 5. Apply: batch creates with createMany + scope-updates + deleteMany in a transaction (I2)
      const createData = toCreate
        .map((triple) => {
          const permId = permMap.get(`${triple.module}:${triple.action}`);
          if (!permId || permId.startsWith('__new__')) return null;
          return { roleId, permissionId: permId, scope: triple.scope };
        })
        .filter((x): x is { roleId: string; permissionId: string; scope: Scope } => x !== null);

      const updateOps = toUpdate.map((upd) =>
        db.rolePermission.update({ where: { id: upd.id }, data: { scope: upd.newScope } }),
      );

      const deleteIds = toDelete.map((d) => d.id);

      await db.$transaction([
        ...(createData.length > 0
          ? [db.rolePermission.createMany({ data: createData, skipDuplicates: true })]
          : []),
        ...updateOps,
        ...(deleteIds.length > 0
          ? [db.rolePermission.deleteMany({ where: { id: { in: deleteIds } } })]
          : []),
      ]);

      console.log(`  [${systemRole.slug}] applied (creates=${toCreate.length} updates=${toUpdate.length} deletes=${toDelete.length})`);
    }

    console.log('');
  }

  // ---------------------------------------------------------------------------
  // I1 — Aggregated review blocks (printed after org loop)
  // ---------------------------------------------------------------------------
  if (deleteAccum.size > 0) {
    console.log('=== DELETIONS (review before --apply) ===');
    for (const entry of deleteAccum.values()) {
      console.log(`  ${entry.role} ${entry.key}@${entry.scope} (orgs: ${entry.orgCount})`);
    }
    console.log('');
  }

  if (updateAccum.size > 0) {
    console.log('=== SCOPE CHANGES ===');
    for (const entry of updateAccum.values()) {
      console.log(`  ${entry.role} ${entry.key} ${entry.oldScope}→${entry.newScope} (orgs: ${entry.orgCount})`);
    }
    console.log('');
  }

  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(
    `mode=${mode} orgs=${orgs.length} creates=${totalCreates} updates=${totalUpdates} deletes=${totalDeletes}`,
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
