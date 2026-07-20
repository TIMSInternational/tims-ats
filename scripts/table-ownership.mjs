// WP1.7 — table-ownership ledger check. Pure, dependency-free (Node stdlib only) so BOTH
// the TS CI (via tests/governance/table-ownership.test.ts) and the .NET CI can invoke it.
//
// Enforces docs/architecture/table-ownership.md: exactly one ORM owns each table's DDL. A PR
// that lets Prisma and EF Core both claim a table (cross-owner collision), or that maps a new
// EF table without registering it in the ledger, fails.
//
// Run as a script (`node scripts/table-ownership.mjs`) it validates the real repo and exits
// non-zero on any violation. Its pure functions are unit-tested with crafted inputs.

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse the single ```json block out of the ledger markdown. */
export function parseLedger(markdown) {
  const match = markdown.match(/```json\s*([\s\S]*?)```/);
  if (!match) throw new Error('table-ownership.md: no ```json ledger block found');
  const ledger = JSON.parse(match[1]);
  if (ledger.defaultOwner !== 'prisma') throw new Error('ledger defaultOwner must be "prisma" in Phase 1');
  if (!Array.isArray(ledger.efcore)) throw new Error('ledger.efcore must be an array');
  // efcoreReadOnly (optional): Prisma-OWNED tables that EF maps READ-ONLY during coexistence
  // (identity/API-key reads, Phase 2). These are NOT ownership transfers — Prisma still owns the
  // DDL; EF only SELECTs. They therefore DO appear in the Prisma schema (not a collision).
  if (ledger.efcoreReadOnly !== undefined && !Array.isArray(ledger.efcoreReadOnly)) {
    throw new Error('ledger.efcoreReadOnly must be an array when present');
  }
  // efcoreAppendOnly (optional): Prisma-OWNED tables that EF maps APPEND-ONLY (INSERT only) during
  // coexistence — the WP2.7 audit plane's single data_access_logs writer. Prisma still owns the
  // DDL/migrations; EF only INSERTs (never UPDATE/DELETE) under tenant RLS. Like efcoreReadOnly they
  // MUST appear in the Prisma schema (Prisma owns the schema), so it is NOT a cross-owner collision —
  // but unlike efcoreReadOnly the intent is honestly "C# writes it", not "read-only".
  if (ledger.efcoreAppendOnly !== undefined && !Array.isArray(ledger.efcoreAppendOnly)) {
    throw new Error('ledger.efcoreAppendOnly must be an array when present');
  }
  // efcoreStranglerWrite (optional): Prisma-OWNED tables that EF UPDATEs for a specific documented vendor
  // write during an in-progress Phase-5 strangler (Slice 2 preemployment_validations). Prisma still owns
  // the DDL/migrations AND another (staff) write path to the same table, so a deploy flag keeps exactly
  // one ACTIVE runtime writer — NOT yet an ownership transfer. Like efcoreReadOnly/efcoreAppendOnly they
  // MUST appear in the Prisma schema (Prisma owns the schema), so it is NOT a cross-owner collision.
  if (ledger.efcoreStranglerWrite !== undefined && !Array.isArray(ledger.efcoreStranglerWrite)) {
    throw new Error('ledger.efcoreStranglerWrite must be an array when present');
  }
  // quartzInfra (optional): cross-tenant SCHEDULER INFRA tables (the Quartz.NET clustered ADO store, Phase-4
  // Slice-2). Owned by NEITHER ORM — Quartz owns the DDL via a hand-applied .sql; they are RLS-EXEMPT and must
  // NOT be @@map'd by Prisma nor .ToTable'd by EF (the check enforces both). Recorded here so the ledger stays
  // the complete source of truth for every table's owner.
  if (ledger.quartzInfra !== undefined && !Array.isArray(ledger.quartzInfra)) {
    throw new Error('ledger.quartzInfra must be an array when present');
  }
  return ledger;
}

/** Every table mapped by Prisma `@@map("…")` across the schema dir. */
export function parsePrismaTables(schemaDir) {
  const tables = new Set();
  for (const file of readdirSync(schemaDir)) {
    if (!file.endsWith('.prisma')) continue;
    const text = readFileSync(join(schemaDir, file), 'utf8');
    for (const m of text.matchAll(/@@map\("([^"]+)"\)/g)) tables.add(m[1]);
  }
  return [...tables];
}

/** Every table an EF DbContext maps via `.ToTable("…")` in the C# platform. */
export function parseEfCoreTables(srcDir) {
  const tables = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'bin' || entry.name === 'obj') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.cs')) {
        const text = readFileSync(full, 'utf8');
        // Match the first string arg of ToTable regardless of what follows — `.ToTable("x")`,
        // `.ToTable("x", "schema")`, `.ToTable("x", t => ...)` all name table "x". (Anchoring on the
        // closing `)` would MISS the schema-qualified/builder overloads, letting an EF mapping of a
        // Prisma/Quartz table slip past the ownership guard.)
        for (const m of text.matchAll(/\.ToTable\("([^"]+)"/g)) tables.add(m[1]);
      }
    }
  };
  walk(srcDir);
  return [...tables];
}

/**
 * The pure check. Returns a list of violation strings (empty = clean).
 *  - collision: a table appears in BOTH efcore[] (EF-OWNED) and Prisma's @@map set.
 *  - unregistered: an EF ToTable(...) table not listed in efcore[], efcoreReadOnly[] NOR efcoreAppendOnly[].
 *  - read-only-not-prisma: a table in efcoreReadOnly[] that Prisma does NOT @@map (a read-only
 *    mapping must point at a real Prisma-owned table).
 *  - append-only-not-prisma: a table in efcoreAppendOnly[] that Prisma does NOT @@map (an append-only
 *    mapping must point at a real Prisma-owned table — Prisma still owns the schema).
 *  - strangler-write-not-prisma: a table in efcoreStranglerWrite[] that Prisma does NOT @@map (a
 *    strangler-write mapping must point at a real Prisma-owned table — Prisma still owns the schema
 *    until the ownership flip).
 *
 *  - quartz-infra-claimed-by-prisma / -by-efcore: a table in quartzInfra[] that an ORM claims (Prisma @@map
 *    or EF ToTable). Scheduler infra tables are owned by neither ORM — Quartz owns the DDL via hand-applied SQL.
 *
 * @param {{ efcore: string[], efcoreReadOnly?: string[], efcoreAppendOnly?: string[], efcoreStranglerWrite?: string[], quartzInfra?: string[], prismaTables: string[], efcoreTables?: string[] }} input
 * @returns {string[]}
 */
export function checkOwnership({ efcore, efcoreReadOnly = [], efcoreAppendOnly = [], efcoreStranglerWrite = [], quartzInfra = [], prismaTables, efcoreTables }) {
  const violations = [];
  const registeredEfTables = new Set([...efcore, ...efcoreReadOnly, ...efcoreAppendOnly, ...efcoreStranglerWrite]);
  const prismaSet = new Set(prismaTables);

  for (const t of efcore) {
    if (prismaSet.has(t)) {
      violations.push(`cross-owner collision: "${t}" is efcore-OWNED in the ledger but also @@map'd in the Prisma schema (an ownership transfer must remove the Prisma model)`);
    }
  }
  for (const t of efcoreReadOnly) {
    if (!prismaSet.has(t)) {
      violations.push(`read-only mapping of a non-Prisma table: "${t}" is in efcoreReadOnly[] but is not @@map'd in the Prisma schema`);
    }
  }
  for (const t of efcoreAppendOnly) {
    if (!prismaSet.has(t)) {
      violations.push(`append-only mapping of a non-Prisma table: "${t}" is in efcoreAppendOnly[] but is not @@map'd in the Prisma schema`);
    }
  }
  for (const t of efcoreStranglerWrite) {
    if (!prismaSet.has(t)) {
      violations.push(`strangler-write mapping of a non-Prisma table: "${t}" is in efcoreStranglerWrite[] but is not @@map'd in the Prisma schema`);
    }
  }
  const efcoreSet = new Set(efcoreTables ?? []);
  for (const t of quartzInfra) {
    if (prismaSet.has(t)) {
      violations.push(`quartz-infra table claimed by Prisma: "${t}" is in quartzInfra[] (scheduler infra, owned by neither ORM) but is @@map'd in the Prisma schema`);
    }
    if (efcoreSet.has(t)) {
      violations.push(`quartz-infra table claimed by EF: "${t}" is in quartzInfra[] (scheduler infra, owned by neither ORM) but is .ToTable'd by an EF DbContext`);
    }
  }
  for (const t of efcoreTables ?? []) {
    if (!registeredEfTables.has(t)) {
      violations.push(`unregistered EF table: "${t}" is mapped by an EF DbContext (ToTable) but is not listed in the ledger's efcore[], efcoreReadOnly[], efcoreAppendOnly[] or efcoreStranglerWrite[]`);
    }
  }
  return violations;
}

/** Validate the real repository against its ledger. */
export function checkRepo(root = REPO_ROOT) {
  const ledger = parseLedger(readFileSync(join(root, 'docs/architecture/table-ownership.md'), 'utf8'));
  const prismaTables = parsePrismaTables(join(root, 'packages/db/prisma/schema'));
  const efcoreTables = parseEfCoreTables(join(root, 'services/Tims.Platform/src'));
  return checkOwnership({
    efcore: ledger.efcore,
    efcoreReadOnly: ledger.efcoreReadOnly ?? [],
    efcoreAppendOnly: ledger.efcoreAppendOnly ?? [],
    efcoreStranglerWrite: ledger.efcoreStranglerWrite ?? [],
    quartzInfra: ledger.quartzInfra ?? [],
    prismaTables,
    efcoreTables,
  });
}

// CLI entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = checkRepo();
  if (violations.length > 0) {
    console.error('table-ownership check FAILED:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('table-ownership check passed.');
}
