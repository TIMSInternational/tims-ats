import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── Every function DDL in committed SQL pins its search_path ──────────────────
//
// Supabase database lint 0011 (`function_search_path_mutable`) flags any function in
// an exposed schema that has no function-level `search_path`. Without one, unqualified
// names in the body resolve against the CALLER's search_path.
//
// The trap this test exists for: `CREATE OR REPLACE FUNCTION` without a `SET` clause
// RESETS the function's proconfig. So pinning a function with `ALTER FUNCTION ... SET`
// is undone the next time any script re-creates it. The only durable fix is for every
// statement that (re)creates a function to carry the pin itself — which is what this
// asserts, over every committed `.sql` the repo can apply.
//
// Out of scope, deliberately:
//   * packages/db/baseline/ — a pg_dump OF production. It records what prod IS, not what
//     the repo applies; it changes only by re-capture after the owner applies DDL.
//   * the backup-drill fixture — synthetic data restored into a throwaway database.
// The C# builder (AuditImmutability.BuildAppendOnlySql) is pinned by its own unit test
// and by ProdSqlMatchesBuilderTests, which keeps it byte-identical to two files below.

const ROOT = join(__dirname, '../..');
const SCAN_ROOTS = ['packages/db/prisma', 'services/Tims.Platform/db', 'scripts'];
const EXCLUDED = new Set(['scripts/backup-drill/fixtures/synthetic-source.sql']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'worktrees']);

function sqlFilesUnder(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...sqlFilesUnder(p));
    else if (p.endsWith('.sql')) out.push(p);
  }
  return out;
}

const CREATE_FN = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi;

/**
 * Each function statement, from `CREATE` to the `;` that follows the closing
 * dollar-quote of its body. Assumes `$$` or `$tag$` quoting, which is all this repo uses;
 * a statement whose body cannot be delimited is returned whole to the end of the file,
 * so it can only fail the check, never slip past it.
 */
function functionStatements(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(CREATE_FN)) {
    const start = m.index ?? 0;
    const rest = sql.slice(start);
    const open = /\$([A-Za-z_]*)\$/.exec(rest);
    if (!open) {
      out.push(rest);
      continue;
    }
    const tag = open[0];
    const close = rest.indexOf(tag, open.index + tag.length);
    if (close < 0) {
      out.push(rest);
      continue;
    }
    const end = rest.indexOf(';', close + tag.length);
    out.push(end < 0 ? rest : rest.slice(0, end + 1));
  }
  return out;
}

const PINNED = /\bSET\s+search_path\s*(?:=|TO)\s*/i;

/**
 * The function's OPTION text only: dollar-quoted and single-quoted bodies and `--` comments removed, so a
 * `SET search_path` that appears inside the body or a comment cannot satisfy the check (tier-1 review). A
 * quoted option value (`SET search_path = ''`) survives because only `AS '...'` bodies are stripped.
 */
function optionsOf(stmt: string): string {
  return stmt
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/\bAS\s+'(?:[^']|'')*'/gi, ' AS ')
    .replace(/--[^\n]*/g, ' ');
}

describe('governance — committed function DDL pins search_path', () => {
  const files = SCAN_ROOTS.flatMap((r) => sqlFilesUnder(join(ROOT, r))).filter((f) => !EXCLUDED.has(relative(ROOT, f)));
  const statements = files.flatMap((f) =>
    functionStatements(readFileSync(f, 'utf8')).map((stmt) => ({ file: relative(ROOT, f), stmt })),
  );

  it('scans a non-empty population (non-vacuity)', () => {
    // Two known function-creating scripts: the CB-1 / CB-1b immutability guards.
    expect(files.length).toBeGreaterThan(20);
    expect(statements.length).toBeGreaterThanOrEqual(2);
  });

  it('every CREATE [OR REPLACE] FUNCTION carries SET search_path', () => {
    const offenders = statements
      .filter(({ stmt }) => !PINNED.test(optionsOf(stmt)))
      .map(({ file, stmt }) => `${file}: ${stmt.split('\n')[0]}`);
    expect(
      offenders,
      "Add `SET search_path = ''` (or an explicit schema list) to the function definition. A CREATE OR " +
        'REPLACE without it RESETS any pin applied earlier by ALTER FUNCTION (Supabase lint 0011).\nOffenders:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('a SET search_path inside the body or a comment does not count as a pin (tier-1 review)', () => {
    for (const fake of [
      "CREATE FUNCTION f() RETURNS int AS $$\n  SELECT 1; -- SET search_path = ''\n$$ LANGUAGE sql;",
      "CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN EXECUTE 'SET search_path = public'; END $fn$ LANGUAGE plpgsql;",
      "CREATE FUNCTION f() RETURNS int\n-- SET search_path = ''\nAS $$ SELECT 1 $$ LANGUAGE sql;",
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1 /* SET search_path = x */';",
    ]) {
      const [stmt] = functionStatements(fake);
      expect(PINNED.test(optionsOf(stmt ?? fake)), fake).toBe(false);
    }
    const [real] = functionStatements(
      "CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 1 $$;",
    );
    expect(PINNED.test(optionsOf(real ?? ''))).toBe(true);
  });

  it('both the apply and the ROLLBACK instructions require regenerating the flip-DDL after re-capture (tier-1 review)', () => {
    for (const f of [
      'packages/db/prisma/manual/2026-10-12-pin-function-search-path.sql',
      'packages/db/prisma/manual/2026-10-12-pin-function-search-path.ROLLBACK.sql',
    ]) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      expect(text, f).toMatch(/schema-baseline\.sh capture/);
      expect(text, f).toMatch(/regenerate every services\/Tims\.Platform\/db\/flip-ddl\/\*\.sql/);
    }
  });

  it('the statement splitter really sees an unpinned function (the check can fail)', () => {
    const [unpinned] = functionStatements(
      'CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;\nSELECT 2;',
    );
    expect(unpinned).toBe('CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;');
    expect(PINNED.test(unpinned)).toBe(false);

    const [pinned] = functionStatements(
      "CREATE FUNCTION g() RETURNS trigger AS $body$ BEGIN RETURN NULL; END; $body$ LANGUAGE plpgsql SET search_path = '';",
    );
    expect(PINNED.test(pinned)).toBe(true);
  });
});
