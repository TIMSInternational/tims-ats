#!/usr/bin/env node
/**
 * Extract a table's complete, executable DDL out of the committed production baseline — issue #128.
 *
 * WHY THIS EXISTS
 * ---------------
 * The ownership-flip runbook's §0 P8: deleting a Prisma model can remove the ONLY executable definition
 * of a table from the repository. `prisma db push` is the documented post-clone bootstrap step
 * (CLAUDE.md:32, README.md), so a flipped table simply stops existing on fresh dev databases, and seeds
 * that reference it hard-fail.
 *
 * Measured on main after flip #1: of 101 Prisma-mapped tables, only 17 have a `CREATE TABLE` anywhere in
 * packages/db/prisma/{migrations,manual}. The other 84 were created by `prisma db push` and exist as DDL
 * nowhere. P8 therefore blocks almost every flip in #28.
 *
 * #115 made this cheap: packages/db/baseline/prod-public-schema.sql is a committed `pg_dump --schema-only`
 * of production containing all 119 tables. The runbook's P8 remedy asks for DDL "read from pg_catalog, not
 * from the migration source" — the baseline IS that, already reviewed and kept current by /gate check 16.
 *
 * WHAT IT EMITS, and in what order (order matters — see FKs)
 *   1. CREATE TYPE      enum dependencies of the requested tables (they must exist before the columns)
 *   2. CREATE TABLE     IF NOT EXISTS
 *   3. sequences        + their column defaults, when a requested table owns one
 *   4. PK/UNIQUE        via a pg_constraint existence guard (Postgres has no ADD CONSTRAINT IF NOT EXISTS)
 *   5. indexes          IF NOT EXISTS
 *   6. RLS              ENABLE + FORCE (both idempotent) then DROP POLICY IF EXISTS + CREATE POLICY
 *   7. triggers         with their function dependency reported, not silently dropped
 *   8. GRANTs           guarded on the grantee role existing (app_tenant may not exist on a fresh DB)
 *   9. FOREIGN KEYS     LAST, so a multi-table extraction applies in any order
 *
 * NOT A PRODUCTION MIGRATION. The tables already exist in prod; this is a bootstrap/dev-parity artifact.
 * The generated header says so, and /gate check 16 is what proves nothing was applied to prod.
 *
 * USAGE
 *   node scripts/db/extract-table-ddl.mjs surveys survey_responses
 *   node scripts/db/extract-table-ddl.mjs --out services/Tims.Platform/db/manual/x.sql surveys
 *
 * Exits 0 on success, 1 on a usage/lookup error, 2 if the baseline is missing or unparseable — the same
 * "could not run is not success" convention as scripts/db/schema-baseline.sh.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_REL = 'packages/db/baseline/prod-public-schema.sql';

/** The sentinel schema-baseline.sh writes; everything before it is generated header, not dump. */
const HEADER_SENTINEL = '-- >>> END BASELINE HEADER';

/**
 * Split a pg_dump into its `-- Name: X; Type: T; ...` blocks.
 *
 * pg_dump delimits every object with a three-line comment banner:
 *
 *     --
 *     -- Name: salary_adjustments; Type: TABLE; Schema: public; Owner: postgres
 *     --
 *
 * followed by the statements for that object. Anchoring on this banner rather than on statement text is
 * what makes the parse reliable: it is emitted by pg_dump itself, it names the object type explicitly,
 * and it cannot be confused by a table name appearing inside another table's statement (a FOREIGN KEY
 * referencing `users` must NOT be attributed to `users`).
 *
 * @param {string} dump
 * @returns {{ type: string, name: string, schema: string, body: string }[]}
 */
export function parseBlocks(dump) {
  const sentinelAt = dump.indexOf(HEADER_SENTINEL);
  if (sentinelAt !== -1) dump = dump.slice(dump.indexOf('\n', sentinelAt) + 1);

  const lines = dump.split('\n');
  const blocks = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const m = /^-- Name: (.+); Type: ([A-Z][A-Z ]*); Schema: ([^;]*); Owner:/.exec(lines[i]);
    if (m && lines[i - 1] === '--' && lines[i + 1] === '--') {
      if (current) {
        // The lone `--` that opens THIS banner was already appended to the previous block's body.
        // Left in place it parses as a statement `--;`, so strip it (and any trailing blanks).
        current.body = current.body.replace(/(?:^|\n)--[ \t]*\n?$/, '\n');
        blocks.push(current);
      }
      current = { type: m[2].trim(), name: m[1].trim(), schema: m[3].trim(), body: '' };
      i++; // skip the trailing `--`
      continue;
    }
    if (current) current.body += lines[i] + '\n';
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Which table a block belongs to. Deliberately per-type rather than "find any table name in the body":
 * an FK block mentions two tables and must be attributed to the ALTER TABLE target, never the REFERENCES
 * target. Returns null when the block is not table-scoped (SCHEMA, FUNCTION, TYPE, DEFAULT ACL...).
 *
 * @param {{type: string, name: string, schema?: string, body: string}} block
 * @returns {string | null}
 */
export function tableOf(block) {
  // Only `public` is extractable. The baseline also dumps `supabase_migrations`, whose
  // `schema_migrations` table is the Supabase provenance ledger — never a flip candidate, and pulling it
  // into an extraction would be actively wrong. Returning null here makes that structural rather than
  // relying on nobody ever asking for it by name.
  if (block.schema && block.schema !== 'public') return null;
  const b = block.body;
  const pick = (re) => {
    const m = re.exec(b);
    return m ? m[1] : null;
  };
  switch (block.type) {
    case 'TABLE':
      return pick(/CREATE TABLE (?:IF NOT EXISTS )?public\.("?[\w]+"?)\s*\(/);
    case 'CONSTRAINT':
    case 'FK CONSTRAINT':
    case 'DEFAULT':
      return pick(/ALTER TABLE (?:ONLY )?public\.("?[\w]+"?)/);
    case 'INDEX':
      return pick(/\bON public\.("?[\w]+"?)\s+USING/);
    case 'ROW SECURITY':
      return pick(/ALTER TABLE (?:ONLY )?public\.("?[\w]+"?)/);
    case 'POLICY':
      return pick(/\bON public\.("?[\w]+"?)/);
    case 'TRIGGER':
      return pick(/\bON public\.("?[\w]+"?)\s+FOR EACH/);
    case 'ACL':
      // Only TABLE ACLs are table-scoped. A SEQUENCE ACL (`GRANT ... ON SEQUENCE public.x_seq`) is
      // resolved separately in buildDdl via the sequence→table mapping, because that needs the
      // `SEQUENCE OWNED BY` block and this function is per-block. See sequenceOfAcl.
      return pick(/\bON TABLE public\.("?[\w]+"?)\s/);
    case 'SEQUENCE OWNED BY':
      return pick(/OWNED BY public\.("?[\w]+"?)\./);
    default:
      return null;
  }
}

/**
 * The sequence a `GRANT ... ON SEQUENCE public.x_seq` block targets, or null if it is not a sequence ACL.
 * Needed because dropping these silently would leave `app_tenant` without USAGE on a sequence its
 * table's column default calls `nextval()` on — inserts would then fail on a fresh dev database.
 */
export function sequenceOfAcl(block) {
  if (block.type !== 'ACL') return null;
  const m = /\bON SEQUENCE public\.("?[\w]+"?)/.exec(block.body);
  return m ? m[1].replace(/^"|"$/g, '') : null;
}

/** Enum type names a CREATE TABLE body depends on, e.g. `public."ReviewCycleStatus"`. */
export function enumDepsOf(createTableBody) {
  return [...new Set([...createTableBody.matchAll(/public\.("([A-Za-z_]\w*)")/g)].map((m) => m[1]))];
}

/** Roles a GRANT statement targets, so the emitted GRANT can be guarded on the role existing. */
export function granteesOf(aclBody) {
  return [...new Set([...aclBody.matchAll(/\bTO\s+([A-Za-z_]\w*)\s*;/g)].map((m) => m[1]))].filter(
    (r) => r.toUpperCase() !== 'PUBLIC',
  );
}

const trimBlank = (s) => s.replace(/^\n+/, '').replace(/\n+$/, '');

/** Statements in a block, minus the noise this artifact must not carry. */
function statements(body) {
  return trimBlank(body)
    .split(/;\s*\n/)
    .map((s) => trimBlank(s))
    .filter(Boolean)
    // Re-terminate. The split consumes the `;` it matched on, but the body's FINAL statement has no
    // trailing newline for the pattern to match, so its `;` survives — strip before adding, or every
    // extraction ends up with `;;`.
    .map((s) => s.replace(/;+\s*$/, '') + ';')
    // OWNER TO would fail on a dev DB whose user is not `postgres`, and ownership is not what this
    // artifact is for. Dev parity means structure + RLS + grants; the creating user owns it.
    .filter((s) => !/^ALTER (TABLE|SEQUENCE|TYPE) .* OWNER TO /s.test(s));
}

/**
 * Build the SQL. Pure — takes the dump text and table names, returns { sql, warnings, found }.
 *
 * @param {string} dump
 * @param {string[]} tables
 * @param {{ sourceNote?: string }} [opts]
 */
export function buildDdl(dump, tables, opts = {}) {
  const blocks = parseBlocks(dump);
  if (blocks.length === 0) throw new Error('no pg_dump object blocks found — is this a --schema-only dump?');

  const want = new Set(tables);
  const warnings = [];
  const byType = (t) => blocks.filter((b) => b.type === t && want.has(stripQ(tableOf(b) ?? '')));

  const tableBlocks = byType('TABLE');
  const found = tableBlocks.map((b) => stripQ(tableOf(b)));
  for (const t of tables) if (!found.includes(t)) warnings.push(`table not found in baseline: ${t}`);

  // ── enum dependencies ────────────────────────────────────────────────────────────────────────────
  const neededEnums = new Set();
  for (const b of tableBlocks) for (const e of enumDepsOf(b.body)) neededEnums.add(e);
  const enumBlocks = blocks.filter(
    (b) => b.type === 'TYPE' && neededEnums.has(`"${b.name}"`),
  );
  for (const e of neededEnums) {
    if (!enumBlocks.some((b) => `"${b.name}"` === e)) warnings.push(`enum used but not found in baseline: ${e}`);
  }

  // ── sequences owned by a requested table ─────────────────────────────────────────────────────────
  const ownedBy = blocks.filter((b) => b.type === 'SEQUENCE OWNED BY' && want.has(stripQ(tableOf(b) ?? '')));
  const seqNames = new Set(
    ownedBy.map((b) => (/ALTER SEQUENCE public\.("?[\w]+"?)/.exec(b.body) ?? [])[1]).filter(Boolean).map(stripQ),
  );
  const seqBlocks = blocks.filter((b) => b.type === 'SEQUENCE' && seqNames.has(stripQ(b.name)));

  const out = [];
  const section = (title) => out.push('', `-- ${'─'.repeat(94)}`, `-- ${title}`, `-- ${'─'.repeat(94)}`, '');

  // ── header ───────────────────────────────────────────────────────────────────────────────────────
  out.push(
    '-- GENERATED FILE — DO NOT EDIT BY HAND.',
    `-- Regenerate: node scripts/db/extract-table-ddl.mjs ${tables.join(' ')}`,
    '--',
    `-- Tables: ${found.join(', ') || '(none)'}`,
    `-- Source: ${BASELINE_REL}${opts.sourceNote ? ` (${opts.sourceNote})` : ''}`,
    '--',
    '-- WHY THIS FILE EXISTS (issue #128, runbook §0 P8)',
    '-- Deleting a Prisma model during an ownership flip can remove the only executable definition of a',
    '-- table from this repository. `prisma db push` is the documented post-clone bootstrap step, so',
    '-- without this file a fresh dev database would simply not have the table, and seeds referencing it',
    '-- would fail. This DDL is extracted from the committed pg_dump of production, so it is what prod',
    '-- ACTUALLY has — not what a migration file claims (see #111).',
    '--',
    '-- ⚠  NEVER APPLY THIS TO PRODUCTION. These tables already exist there. This is a bootstrap and',
    '--    dev-parity artifact. Production DDL goes through docs/architecture/ddl-governance.md.',
    '--',
    '-- Idempotent and safe to re-run: IF NOT EXISTS on tables/indexes, catalog guards on constraints,',
    '-- DROP POLICY IF EXISTS before CREATE POLICY, and GRANTs guarded on the role existing.',
    '',
    'BEGIN;',
  );

  if (enumBlocks.length) {
    section('1. Enum types — must exist before the columns that use them');
    for (const b of enumBlocks) {
      // CREATE TYPE has no IF NOT EXISTS; guard on pg_type. Route through statements() so the
      // `ALTER TYPE ... OWNER TO postgres` line is filtered out like every other OWNER statement.
      const body = statements(b.body).join('\n\n');
      out.push(
        `DO $$ BEGIN`,
        `  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace`,
        `                  WHERE n.nspname = 'public' AND t.typname = ${lit(b.name)}) THEN`,
        indent(body, 4),
        `  END IF;`,
        `END $$;`,
        '',
      );
    }
  }

  section(`${enumBlocks.length ? 2 : 1}. Tables`);
  for (const b of tableBlocks) {
    // FORCE ROW LEVEL SECURITY lives in pg_dump's TABLE block but belongs with the RLS section below —
    // emitting it here too would duplicate it, and it must follow ENABLE to read coherently.
    for (const s of statements(b.body).filter((s) => !/FORCE ROW LEVEL SECURITY/.test(s))) {
      out.push(s.replace(/^CREATE TABLE public\./, 'CREATE TABLE IF NOT EXISTS public.'), '');
    }
  }

  if (seqBlocks.length || ownedBy.length) {
    section('Sequences owned by these tables');
    for (const b of seqBlocks)
      for (const s of statements(b.body))
        out.push(s.replace(/^CREATE SEQUENCE public\./, 'CREATE SEQUENCE IF NOT EXISTS public.'), '');
    for (const b of [...byType('DEFAULT'), ...ownedBy]) for (const s of statements(b.body)) out.push(s, '');
  }

  section('Primary keys and unique constraints');
  for (const b of byType('CONSTRAINT')) out.push(...guardConstraint(b), '');

  section('Indexes');
  for (const b of byType('INDEX'))
    for (const s of statements(b.body))
      out.push(s.replace(/^CREATE (UNIQUE )?INDEX /, (_, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `), '');

  section('Row-level security — the tenant-isolation guard, as it exists in production');
  for (const b of byType('ROW SECURITY')) for (const s of statements(b.body)) out.push(s, '');
  for (const b of tableBlocks)
    for (const s of statements(b.body).filter((s) => /FORCE ROW LEVEL SECURITY/.test(s))) out.push(s, '');
  for (const b of byType('POLICY')) {
    const tbl = tableOf(b);
    const polName = b.name.split(/\s+/).slice(1).join(' ') || b.name;
    out.push(`DROP POLICY IF EXISTS ${quoteIdent(polName)} ON public.${tbl};`);
    for (const s of statements(b.body)) out.push(s, '');
  }

  const triggerBlocks = byType('TRIGGER');
  if (triggerBlocks.length) {
    section('Triggers');
    for (const b of triggerBlocks) {
      const fns = [...new Set([...b.body.matchAll(/EXECUTE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]))];
      for (const fn of fns) {
        warnings.push(
          `trigger ${b.name} calls public.${fn}() — that function is NOT emitted here. Apply it first, or the script will fail.`,
        );
        out.push(`-- Requires public.${fn}() to already exist (see the baseline's FUNCTION blocks).`);
      }
      // CREATE TRIGGER has no IF NOT EXISTS before PG14's CREATE OR REPLACE TRIGGER; drop first.
      const trigName = b.name.split(/\s+/).slice(1).join(' ') || b.name;
      out.push(`DROP TRIGGER IF EXISTS ${quoteIdent(trigName)} ON public.${tableOf(b)};`);
      for (const s of statements(b.body)) out.push(s, '');
    }
  }

  // Table ACLs, plus the ACLs of any sequence owned by a requested table.
  const aclBlocks = [
    ...byType('ACL'),
    ...blocks.filter((b) => b.type === 'ACL' && seqNames.has(sequenceOfAcl(b) ?? '')),
  ];
  if (aclBlocks.length) {
    section('Grants — guarded, because app_tenant may not exist on a fresh dev database');
    for (const b of aclBlocks) {
      for (const s of statements(b.body)) {
        const roles = granteesOf(s);
        if (roles.length === 0) {
          out.push(s, '');
          continue;
        }
        const cond = roles.map((r) => `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(r)})`).join(' AND ');
        out.push(`DO $$ BEGIN`, `  IF ${cond} THEN`, indent(s, 4), `  END IF;`, `END $$;`, '');
      }
    }
  }

  section('Foreign keys — LAST, so a multi-table extraction applies in any order');
  const fkBlocks = byType('FK CONSTRAINT');
  const externalRefs = new Set();
  for (const b of fkBlocks) {
    const ref = (/REFERENCES public\.("?[\w]+"?)/.exec(b.body) ?? [])[1];
    if (ref && !want.has(stripQ(ref))) externalRefs.add(stripQ(ref));
    out.push(...guardConstraint(b), '');
  }
  if (externalRefs.size) {
    warnings.push(
      `foreign keys reference tables NOT in this extraction: ${[...externalRefs].sort().join(', ')} — they must exist first (they normally do, being Prisma-owned).`,
    );
  }

  out.push('COMMIT;', '');
  return { sql: out.join('\n').replace(/\n{3,}/g, '\n\n'), warnings, found };
}

/** Postgres has no `ADD CONSTRAINT IF NOT EXISTS`; wrap in a pg_constraint existence check. */
function guardConstraint(block) {
  const tbl = tableOf(block);
  const conName = (/ADD CONSTRAINT ([\w"]+)/.exec(block.body) ?? [])[1];
  const body = statements(block.body).join('\n');
  if (!conName) return [body];
  return [
    `DO $$ BEGIN`,
    `  IF NOT EXISTS (SELECT 1 FROM pg_constraint`,
    `                  WHERE conname = ${lit(stripQ(conName))}`,
    `                    AND conrelid = 'public.${tbl}'::regclass) THEN`,
    indent(body, 4),
    `  END IF;`,
    `END $$;`,
  ];
}

const stripQ = (s) => s.replace(/^"|"$/g, '');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const quoteIdent = (s) => (/^[a-z_]\w*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);
const indent = (s, n) => s.split('\n').map((l) => (l.trim() ? ' '.repeat(n) + l : l)).join('\n');

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let outPath = null;
  const tables = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outPath = args[++i];
    else if (args[i] === '-h' || args[i] === '--help') {
      console.log('usage: node scripts/db/extract-table-ddl.mjs [--out FILE] <table>...');
      process.exit(0);
    } else tables.push(args[i]);
  }
  if (tables.length === 0) {
    console.error('usage: node scripts/db/extract-table-ddl.mjs [--out FILE] <table>...');
    process.exit(1);
  }

  const baseline = join(REPO_ROOT, BASELINE_REL);
  let dump;
  try {
    dump = readFileSync(baseline, 'utf8');
  } catch {
    console.error(`✖ COULD NOT RUN — no baseline at ${BASELINE_REL}.`);
    console.error('  Create one: bash scripts/db/schema-baseline.sh capture');
    process.exit(2);
  }

  const captured = (/^-- Captured:\s*(.+)$/m.exec(dump) ?? [])[1];
  const server = (/^-- Server version:\s*(.+)$/m.exec(dump) ?? [])[1];

  let result;
  try {
    result = buildDdl(dump, tables, {
      sourceNote: [captured && `captured ${captured}`, server && `server ${server}`].filter(Boolean).join(', '),
    });
  } catch (err) {
    console.error(`✖ COULD NOT RUN — ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }

  const missing = result.warnings.filter((w) => w.startsWith('table not found'));
  if (missing.length) {
    for (const w of missing) console.error(`✖ ${w}`);
    process.exit(1);
  }

  if (outPath) {
    writeFileSync(join(REPO_ROOT, outPath), result.sql);
    console.error(`✓ wrote ${outPath}  (${result.found.join(', ')})`);
  } else {
    process.stdout.write(result.sql);
  }
  for (const w of result.warnings) console.error(`⚠ ${w}`);
}
