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
        for (const m of text.matchAll(/\.ToTable\("([^"]+)"\)/g)) tables.add(m[1]);
      }
    }
  };
  walk(srcDir);
  return [...tables];
}

/**
 * The pure check. Returns a list of violation strings (empty = clean).
 *  - collision: a table appears in BOTH efcore[] (EF-OWNED) and Prisma's @@map set.
 *  - unregistered: an EF ToTable(...) table not listed in efcore[] NOR efcoreReadOnly[].
 *  - read-only-not-prisma: a table in efcoreReadOnly[] that Prisma does NOT @@map (a read-only
 *    mapping must point at a real Prisma-owned table).
 */
export function checkOwnership({ efcore, efcoreReadOnly = [], prismaTables, efcoreTables }) {
  const violations = [];
  const registeredEfTables = new Set([...efcore, ...efcoreReadOnly]);
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
  for (const t of efcoreTables ?? []) {
    if (!registeredEfTables.has(t)) {
      violations.push(`unregistered EF table: "${t}" is mapped by an EF DbContext (ToTable) but is not listed in the ledger's efcore[] or efcoreReadOnly[]`);
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
