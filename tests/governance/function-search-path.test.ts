import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// HOW (#376 tier-1 review): PostgreSQL decides, not a regex. The first version of this test
// stripped bodies and comments with regular expressions, and four review rounds each found
// another shape it got wrong (digits in dollar-quote tags, quoted defaults, `--` inside a
// literal, nested comments). scripts/db/verify-function-search-path.sh applies each file to a
// throwaway PostgreSQL >= 17.6 cluster with psql and reads pg_proc.proconfig from an event
// trigger right after every CREATE FUNCTION / CREATE PROCEDURE the server executes. The
// fixtures below are the shapes the regex version mishandled, now answered by the server.
//
// Needs PostgreSQL >= 17.6 server binaries (initdb, pg_ctl, psql) and node. In CI (CI=true) their absence
// FAILS this test — .github/workflows/ci.yml installs them. Locally it is skipped with a reason.
//
// Out of scope, deliberately:
//   * packages/db/baseline/ — a pg_dump OF production. It records what prod IS, not what
//     the repo applies; it changes only by re-capture after the owner applies DDL.
//   * the backup-drill fixture — synthetic data restored into a throwaway database.
// The C# builder (AuditImmutability.BuildAppendOnlySql) is pinned by its own unit test
// and by ProdSqlMatchesBuilderTests, which keeps it byte-identical to two files below;
// FunctionSearchPathPinTests proves the 2026-10-12 script against a real Postgres.

const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts/db/verify-function-search-path.sh');
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

type GateRun = { code: number | null; out: string };

function gate(files: string[]): GateRun {
  const r = spawnSync('bash', [SCRIPT, ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      ...(process.env.SEARCH_PATH_GATE_PG_BIN ? { SEARCH_PATH_GATE_PG_BIN: process.env.SEARCH_PATH_GATE_PG_BIN } : {}),
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const NO_SERVER = /SEARCH_PATH GATE DID NOT RUN — no PostgreSQL >= [\d.]+ server binaries/;

/** Exit 2 for missing binaries is a skip locally and a failure in CI; any other exit 2 always fails. */
function unavailable(run: GateRun): string | null {
  if (run.code !== 2 || !NO_SERVER.test(run.out)) return null;
  if (process.env.CI === 'true') throw new Error(`search_path gate could not run in CI:\n${run.out}`);
  return 'PostgreSQL >= 17.6 server binaries not found (set SEARCH_PATH_GATE_PG_BIN)';
}

/** "VERDICT identity" lines for one file, sorted. */
function verdicts(out: string, file: string): string[] {
  const result: string[] = [];
  for (const line of out.split('\n')) {
    const m = /^(PINNED|UNPINNED|UNVERIFIED|SYNTAX) +(.+?): (.*)$/.exec(line);
    if (!m || m[2] !== file) continue;
    result.push(m[1] === 'PINNED' || m[1] === 'UNPINNED' ? `${m[1]} ${m[3]}` : (m[1] ?? ''));
  }
  return result.sort();
}

describe('governance — committed function DDL pins search_path (decided by PostgreSQL)', () => {
  const files = SCAN_ROOTS.flatMap((r) => sqlFilesUnder(join(ROOT, r)))
    .filter((f) => !EXCLUDED.has(relative(ROOT, f)))
    .map((f) => relative(ROOT, f))
    .sort();
  let repo: GateRun;

  beforeAll(() => {
    repo = gate(files);
  }, 200_000);

  it('scans a non-empty population (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every CREATE [OR REPLACE] FUNCTION / PROCEDURE in committed SQL carries SET search_path', (ctx) => {
    const reason = unavailable(repo);
    if (reason) return ctx.skip(reason);
    expect(repo.out).toMatch(/✓ search_path gate/);
    expect(repo.code, repo.out).toBe(0);
    // Non-vacuity on the SERVER side: the two CB-1 / CB-1b guard scripts really created their routine.
    expect(verdicts(repo.out, 'packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql')).toEqual([
      'PINNED public.tims_append_only_guard()',
    ]);
    expect(verdicts(repo.out, 'packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql')).toEqual([
      'PINNED public.tims_append_only_guard()',
    ]);
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
});

/**
 * Each fixture is one file; the expected value is the gate's per-file verdict list. The first block is every
 * shape a tier-1 review round found the old regex gate getting wrong.
 */
const FIXTURES: Record<string, { sql: string; expect: string[] }> = {
  'pinned-basic.sql': {
    sql: "CREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 1 $$;",
    expect: ['PINNED public.f()'],
  },
  'unpinned-basic.sql': {
    sql: 'CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;\nSELECT 2;',
    expect: ['UNPINNED public.f()'],
  },
  // r4: digits in the dollar-quote tag, with a fake pin inside the body.
  'dollar-tag-digits.sql': {
    sql:
      "CREATE FUNCTION a() RETURNS int AS $fn1$ SELECT 1; -- SET search_path = ''\n$fn1$ LANGUAGE sql;\n" +
      "CREATE FUNCTION b() RETURNS int AS $a1$ SELECT 1 $a1$ LANGUAGE sql SET search_path TO '';",
    expect: ['PINNED public.b()', 'UNPINNED public.a()'],
  },
  // r4: a quoted argument default containing `$$`, `--` and a pin-shaped string.
  'quoted-default.sql': {
    sql:
      "CREATE FUNCTION a(x text DEFAULT '$$ -- ; SET search_path = x') RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n" +
      "CREATE FUNCTION b(x text DEFAULT '$$ -- ;') RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 1 $$;",
    expect: ['PINNED public.b(pg_catalog.text)', 'UNPINNED public.a(pg_catalog.text)'],
  },
  // r4: `--` inside a string literal (a regex comment-stripper ate the rest of the line, pin included).
  'dashdash-in-literal.sql': {
    sql:
      "CREATE FUNCTION a() RETURNS text LANGUAGE sql AS 'SELECT ''--''' SET search_path = '';\n" +
      "CREATE FUNCTION b() RETURNS text LANGUAGE sql AS 'SELECT ''-- SET search_path = x''';",
    expect: ['PINNED public.a()', 'UNPINNED public.b()'],
  },
  // r1-r3: a pin in the body, in comments (nested too), or after the statement does not count.
  'pin-in-body.sql': {
    sql: "CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN EXECUTE 'SET search_path = public'; END $fn$ LANGUAGE plpgsql;",
    expect: ['UNPINNED public.f()'],
  },
  'pin-in-comments.sql': {
    sql:
      "CREATE FUNCTION a() RETURNS int\n-- SET search_path = ''\nAS $$ SELECT 1 $$ LANGUAGE sql;\n" +
      "CREATE FUNCTION b() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql /* outer /* inner */ SET search_path = '' */;",
    expect: ['UNPINNED public.a()', 'UNPINNED public.b()'],
  },
  'session-set-after.sql': {
    sql: "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1'; SET search_path = public;",
    expect: ['UNPINNED public.f()'],
  },
  'single-quoted-then-pinned.sql': {
    sql:
      "CREATE FUNCTION a() RETURNS int LANGUAGE sql AS 'SELECT 1';\n" +
      "CREATE FUNCTION b() RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 2 $$;",
    expect: ['PINNED public.b()', 'UNPINNED public.a()'],
  },
  // The trap itself: a pin applied by ALTER does not make the CREATE pinned, and CREATE OR REPLACE resets it.
  'alter-after-create.sql': {
    sql: "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';\nALTER FUNCTION f() SET search_path = '';",
    expect: ['UNPINNED public.f()'],
  },
  'replace-resets-pin.sql': {
    sql:
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path = '' AS 'SELECT 1';\n" +
      "CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 2';",
    expect: ['PINNED public.f()', 'UNPINNED public.f()'],
  },
  // Shapes no text check could see.
  // Dynamic SQL is reported (what it created is still checked), and never counts as verified (round 2).
  'do-block-execute.sql': {
    sql: "DO $$ BEGIN EXECUTE 'CREATE FUNCTION g() RETURNS int LANGUAGE sql AS ''SELECT 1'''; END $$;",
    expect: ['UNPINNED public.g()', 'UNVERIFIED'],
  },
  'do-block-loop-masks-branch.sql': {
    sql:
      "DO $do$ BEGIN\n  FOR i IN 1..2 LOOP\n    EXECUTE 'CREATE OR REPLACE FUNCTION a() RETURNS int LANGUAGE sql SET search_path = '''' AS ''SELECT 1''';\n  END LOOP;\n" +
      "  IF EXISTS (SELECT FROM pg_class WHERE relname = 'production_table') THEN\n" +
      "    EXECUTE 'CREATE FUNCTION b() RETURNS int LANGUAGE sql AS ''SELECT 1''';\n  END IF;\nEND $do$;",
    expect: ['PINNED public.a()', 'PINNED public.a()', 'UNVERIFIED'],
  },
  'created-when-called.sql': {
    sql:
      "CREATE FUNCTION mk() RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN\n" +
      "  EXECUTE 'CREATE FUNCTION public.made() RETURNS int LANGUAGE sql SET search_path = '''' AS ''SELECT 1''';\nEND $$;\n" +
      'SELECT mk();',
    expect: ['PINNED public.made()', 'PINNED public.mk()', 'UNVERIFIED', 'UNVERIFIED'],
  },
  'procedure.sql': {
    sql: 'CREATE PROCEDURE p() LANGUAGE sql AS $$ SELECT 1 $$;',
    expect: ['UNPINNED public.p()'],
  },
  'mention-only-in-comment.sql': {
    sql: "-- CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';\nSELECT 1;",
    expect: [],
  },
  // The file cannot hide its routines from the gate.
  // Every one of these is refused for the non-superuser that applies files, so the routine is still seen.
  'tamper-settings.sql': {
    sql:
      'SET client_min_messages = error;\nSET log_min_messages = panic;\nSET log_statement = none;\n' +
      'SET session_replication_role = replica;\n' +
      'ALTER EVENT TRIGGER search_path_gate_end DISABLE;\nDROP EVENT TRIGGER search_path_gate_start;\n' +
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';",
    expect: ['UNPINNED public.f()'],
  },
  // tier-1 round 1: psql meta-commands are refused (\restrict), so a file cannot reconnect as the superuser
  // (or to another database) and cannot run a shell. The refusal is itself reported, and what follows is
  // still checked as the non-superuser.
  'connect-as-admin.sql': {
    sql:
      '\\connect - gate_admin\nALTER EVENT TRIGGER search_path_gate_start DISABLE;\n' +
      "ALTER EVENT TRIGGER search_path_gate_end DISABLE;\nCREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';",
    expect: ['UNPINNED public.f()', 'UNVERIFIED'],
  },
  'connect-other-db.sql': {
    sql: "\\connect postgres\nCREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';",
    expect: ['UNPINNED public.f()', 'UNVERIFIED'],
  },
  'shell-escape.sql': {
    sql: "\\! touch @DIR@/SHELL_ESCAPE_RAN\nCREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path = '' AS 'SELECT 1';",
    expect: ['PINNED public.f()', 'UNVERIFIED'],
  },
  // tier-1 round 1: a routine on a path the empty database does not take is never executed, so the server
  // cannot report it — the statement's own text says it would have created one.
  'do-block-fails-first.sql': {
    sql:
      'DO $$ BEGIN\n  PERFORM 1 FROM existing_production_table;\n' +
      "  EXECUTE 'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS ''SELECT 1''';\nEND $$;",
    expect: ['UNVERIFIED'],
  },
  'do-block-untaken-branch.sql': {
    sql:
      "DO $$ BEGIN\n  IF EXISTS (SELECT FROM pg_class WHERE relname = 'existing_production_table') THEN\n" +
      "    EXECUTE 'CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS ''SELECT 1''';\n  END IF;\nEND $$;",
    expect: ['UNVERIFIED'],
  },
  'do-block-one-of-two.sql': {
    sql:
      "DO $$ BEGIN\n  EXECUTE 'CREATE FUNCTION a() RETURNS int LANGUAGE sql SET search_path = '''' AS ''SELECT 1''';\n" +
      "  IF false THEN EXECUTE 'CREATE FUNCTION b() RETURNS int LANGUAGE sql AS ''SELECT 1'''; END IF;\nEND $$;",
    expect: ['PINNED public.a()', 'UNVERIFIED'],
  },
  // The session dies mid-file, so the rest of it never ran: psql's non-zero exit is the only signal.
  'terminates-own-backend.sql': {
    sql: "SELECT pg_terminate_backend(pg_backend_pid());\nCREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';",
    expect: ['UNVERIFIED'],
  },
  // Fail closed when the server cannot read the pin.
  'missing-type.sql': {
    sql: "CREATE FUNCTION f(x no_such_type) RETURNS int LANGUAGE sql SET search_path = '' AS 'SELECT 1';",
    expect: ['UNVERIFIED'],
  },
  'syntax-error.sql': {
    sql: 'CREATE FUNCTION f( RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;',
    expect: ['SYNTAX'],
  },
  // A file's own \set ON_ERROR_STOP is refused like every meta-command, so the file runs to the end.
  'sets-on-error-stop.sql': {
    sql: "\\set ON_ERROR_STOP on\nSELECT 1/0;\nCREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path = '' AS 'SELECT 1';",
    expect: ['PINNED public.f()', 'UNVERIFIED'],
  },
  // Pre-filter: a file that never names FUNCTION/PROCEDURE is not applied at all.
  'no-routine-keyword.sql': {
    sql: '\\set ON_ERROR_STOP on\nSELECT 1/0;',
    expect: [],
  },
};

describe('verify-function-search-path.sh — PostgreSQL answers the shapes a regex got wrong', () => {
  let dir: string;
  let run: GateRun;
  let unpinnedInclude: GateRun;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'search-path-gate-'));
    for (const [name, { sql }] of Object.entries(FIXTURES)) writeFileSync(join(dir, name), `${sql.replaceAll('@DIR@', dir)}\n`);
    run = gate(Object.keys(FIXTURES).map((n) => join(dir, n)));
    // ...but a file with a psql include is applied even without the keyword, and the include is refused.
    writeFileSync(join(dir, 'included.txt'), "CREATE FUNCTION inc() RETURNS int LANGUAGE sql AS 'SELECT 1';\n");
    writeFileSync(join(dir, 'includes.sql'), '\\ir included.txt\n');
    unpinnedInclude = gate([join(dir, 'includes.sql')]);
  }, 200_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 1 on the fixture set, which contains violations', (ctx) => {
    const reason = unavailable(run);
    if (reason) return ctx.skip(reason);
    expect(run.code, run.out).toBe(1);
  });

  for (const [name, { expect: want }] of Object.entries(FIXTURES)) {
    it(`${name} → ${want.length ? want.join(', ') : 'no routine'}`, (ctx) => {
      const reason = unavailable(run);
      if (reason) return ctx.skip(reason);
      expect(verdicts(run.out, join(dir, name)), run.out).toEqual([...want].sort());
    });
  }

  it('a psql include is never followed silently: the file is applied and reported UNVERIFIED', (ctx) => {
    const reason = unavailable(unpinnedInclude);
    if (reason) return ctx.skip(reason);
    expect(unpinnedInclude.code, unpinnedInclude.out).toBe(1);
    expect(verdicts(unpinnedInclude.out, join(dir, 'includes.sql'))).toEqual(['UNVERIFIED']);
  });

  it('the shell escape did not run', (ctx) => {
    const reason = unavailable(run);
    if (reason) return ctx.skip(reason);
    expect(existsSync(join(dir, 'SHELL_ESCAPE_RAN'))).toBe(false);
  });

  it('exits 2 — never 0 — when given nothing to check', () => {
    const r = gate([]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/DID NOT RUN/);
  });
});
