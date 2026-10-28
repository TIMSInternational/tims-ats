/**
 * Regression tests for the FAILURE paths of scripts/db/schema-baseline.sh — issue #115.
 *
 * WHY THESE EXIST
 * ---------------
 * The whole point of #115's drift check is that it must distinguish "did not run" from "found
 * nothing". #38 is the precedent: the Codex CLI exits 0 when quota-blocked, so a mandated gate
 * silently no-opped for weeks while every build reported green. A drift check with the same defect
 * would be worse than none — it would certify a schema it never read.
 *
 * So the contract under test is the exit code, not the happy path:
 *
 *   0  ran, live schema matches the committed baseline
 *   1  ran, found drift
 *   2  COULD NOT RUN — never to be reported as a pass
 *
 * Exit 0 is deliberately NOT tested here: it needs live production credentials and a pg_dump >= 17,
 * which no CI runner has. `/gate` check 16 covers it. Everything below runs offline against a stub
 * pg_dump, so these tests never touch a database.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT_REL = 'scripts/db/schema-baseline.sh';
const BASELINE_REL = 'packages/db/baseline/prod-public-schema.sql';

/** A bogus URL: every test must fail before any connection is attempted. */
const FAKE_URL = 'postgresql://nobody:nothing@127.0.0.1:1/none';

let sandbox: string;

/**
 * Copies the script into a throwaway tree so REPO_ROOT (derived from the script's own location)
 * points at a sandbox. This is what lets us test "no committed baseline" without touching the real
 * one — the earlier ad-hoc version of this test mutated the real baseline file, which is exactly the
 * kind of thing that should not be left to a shell history.
 */
function makeTree(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(join(root, 'scripts', 'db'), { recursive: true });
  mkdirSync(join(root, 'packages', 'db', 'baseline'), { recursive: true });
  cpSync(join(REPO_ROOT, SCRIPT_REL), join(root, SCRIPT_REL));
  return root;
}

/** A stub pg_dump that reports the given version, then behaves as told. */
function makeStubPgDump(root: string, version: string, behaviour: 'fail' | 'empty' | 'fixed'): string {
  const path = join(root, `stub-pg_dump-${behaviour}`);
  const body =
    behaviour === 'fail'
      ? 'echo "FATAL: password authentication failed" >&2\nexit 1\n'
      : behaviour === 'empty'
        ? 'exit 0\n'
        : 'echo "CREATE TABLE public.t (id uuid NOT NULL);"\nexit 0\n';
  writeFileSync(
    path,
    `#!/bin/sh\n[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) ${version}"; exit 0; }\n${body}`,
  );
  chmodSync(path, 0o755);
  return path;
}

type Run = { code: number; out: string };

type DumpEntry = { name: string; type: string; schema: string; body: string[] };

/** Lines shaped like pg_dump --schema-only output: a preamble, then one TOC header per entry. */
function pgDump(entries: DumpEntry[], withPreamble = true): string[] {
  const out = withPreamble ? ['--', '-- PostgreSQL database dump', '--', '', 'SET lock_timeout = 0;', ''] : [];
  for (const e of entries) {
    out.push('--', `-- Name: ${e.name}; Type: ${e.type}; Schema: ${e.schema}; Owner: postgres`, '--', '', ...e.body, '', '');
  }
  return out;
}

/** A stub pg_dump emitting fixed lines, so "prod changed" can be simulated by swapping stubs. */
function stubEmitting(root: string, name: string, lines: string[]): string {
  const path = join(root, name);
  writeFileSync(
    path,
    '#!/bin/sh\n[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) 17.0"; exit 0; }\n' +
      `cat <<'SQLEOF'\n${lines.join('\n')}\nSQLEOF\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function run(root: string, args: string[], env: Record<string, string | undefined>): Run {
  try {
    const out = execFileSync('bash', [join(root, SCRIPT_REL), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Strip inherited DB creds so a developer's real .env cannot leak into the test and turn an
      // expected exit 2 into a real production dump. NODE_ENV is carried because this repo augments
      // ProcessEnv to require it.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        ...env,
      },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'schema-baseline-test-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('schema-baseline.sh check — exit 2 means DID NOT RUN, never a pass', () => {
  it('exits 2 when no connection URL is resolvable', () => {
    const root = makeTree('no-url');
    // A valid stub is REQUIRED to isolate this path. The script gates on pg_dump >= 17 first, and CI
    // runners ship pg_dump 14/16 — without the stub this test passes for the wrong reason locally
    // (where a v17 exists) and fails in CI on the version message instead of the URL one.
    const stub = makeStubPgDump(root, '17.0', 'fixed');
    const { code, out } = run(root, ['check'], {
      DIRECT_URL: undefined,
      DATABASE_URL: undefined,
      PG_DUMP: stub,
    });
    expect(code).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).toMatch(/DIRECT_URL or DATABASE_URL/);
  });

  it('exits 2 when the committed baseline is missing, before touching the database', () => {
    const root = makeTree('no-baseline');
    // A working stub would happily dump; the baseline check must still short-circuit first.
    const stub = makeStubPgDump(root, '17.0', 'fixed');
    const { code, out } = run(root, ['check'], { DIRECT_URL: FAKE_URL, PG_DUMP: stub });
    expect(code).toBe(2);
    expect(out).toMatch(/no committed baseline/);
  });

  it('exits 2 when the baseline predates the header sentinel', () => {
    const root = makeTree('headerless');
    writeFileSync(join(root, BASELINE_REL), 'CREATE TABLE public.t (id uuid NOT NULL);\n');
    const stub = makeStubPgDump(root, '17.0', 'fixed');
    const { code, out } = run(root, ['check'], { DIRECT_URL: FAKE_URL, PG_DUMP: stub });
    expect(code).toBe(2);
    expect(out).toMatch(/header sentinel/);
  });

  it('exits 2 when pg_dump fails — a failed dump is not "no drift"', () => {
    const root = makeTree('dump-fails');
    const stub = makeStubPgDump(root, '17.0', 'fail');
    const { code, out } = run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stub });
    expect(code).toBe(2);
    expect(out).toMatch(/pg_dump failed/);
    expect(out).toMatch(/password authentication failed/);
  });

  it('objects-only mode: a failed pg_dump reports categories, never its stderr text (tier-1 round 3)', () => {
    const root = makeTree('dump-fails-objects-only');
    const stub = join(root, 'stub-fail-quoting');
    writeFileSync(
      stub,
      '#!/bin/sh\n[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) 17.0"; exit 0; }\n' +
        'echo "pg_dump: error: query failed: ERROR:  permission denied for table SYNTHETIC_PRIVATE_NAME_42" >&2\n' +
        'echo "pg_dump: detail: Query was: LOCK TABLE public.\\"SYNTHETIC_PRIVATE_NAME_42\\" IN ACCESS SHARE MODE" >&2\n' +
        'exit 1\n',
    );
    chmodSync(stub, 0o755);
    for (const env of [{ SCHEMA_DRIFT_OBJECTS_ONLY: '1' }, { GITHUB_ACTIONS: 'true' }]) {
      for (const cmd of ['capture', 'check']) {
        if (cmd === 'check') writeFileSync(join(root, BASELINE_REL), '-- >>> END BASELINE HEADER — everything below is verbatim pg_dump output\n');
        const { code, out } = run(root, [cmd], { DIRECT_URL: FAKE_URL, PG_DUMP: stub, ...env });
        expect(code).toBe(2);
        expect(out).toMatch(/pg_dump failed/);
        expect(out).toMatch(/2 line\(s\) of pg_dump diagnostics withheld/);
        expect(out).toMatch(/matched categories: permission/);
        expect(out).not.toMatch(/SYNTHETIC_PRIVATE_NAME|LOCK TABLE/);
      }
    }
  });

  it('exits 2 when pg_dump succeeds but emits nothing — the #38 failure mode', () => {
    const root = makeTree('dump-empty');
    const stub = makeStubPgDump(root, '17.0', 'empty');
    const { code, out } = run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stub });
    expect(code).toBe(2);
    expect(out).toMatch(/empty dump/);
    expect(out).not.toMatch(/✓/);
  });

  it('exits 2 on an unknown subcommand rather than assuming "check"', () => {
    const root = makeTree('bad-subcommand');
    const stub = makeStubPgDump(root, '17.0', 'fixed');
    const { code, out } = run(root, ['definitely-not-a-command'], { DIRECT_URL: FAKE_URL, PG_DUMP: stub });
    expect(code).toBe(2);
    // Assert the REASON, not just the code — otherwise this passes on any incidental exit 2 (e.g. an
    // old pg_dump on a CI runner) without ever exercising the subcommand branch.
    expect(out).toMatch(/usage:/);
  });
});

describe('schema-baseline.sh — capture/check round-trip and drift detection', () => {
  it('capture writes a sentinel-bearing baseline, and check then agrees with itself', () => {
    const root = makeTree('roundtrip');
    const stub = makeStubPgDump(root, '17.0', 'fixed');
    const env = { DIRECT_URL: FAKE_URL, PG_DUMP: stub };

    const captured = run(root, ['capture'], env);
    expect(captured.code).toBe(0);
    expect(captured.out).toMatch(/Baseline written/);

    // Same stub output → no drift. This is what proves the header (with its capture timestamp) is
    // excluded from the comparison; an earlier version of the script leaked it and reported phantom
    // drift on every run.
    const checked = run(root, ['check'], env);
    expect(checked.code).toBe(0);
    expect(checked.out).toMatch(/matches the committed baseline/);
  });

  it('exits 1 and names the offending object when the live schema diverges', () => {
    const root = makeTree('drift');
    const stub = makeStubPgDump(root, '17.0', 'fixed');
    expect(run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stub }).code).toBe(0);

    // A different stub stands in for prod having changed under us.
    const drifted = join(root, 'stub-drifted');
    writeFileSync(
      drifted,
      '#!/bin/sh\n[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) 17.0"; exit 0; }\n' +
        'echo "CREATE TABLE public.t (id uuid NOT NULL, snuck_in text);"\nexit 0\n',
    );
    chmodSync(drifted, 0o755);

    const { code, out } = run(root, ['check'], { DIRECT_URL: FAKE_URL, PG_DUMP: drifted });
    expect(code).toBe(1);
    expect(out).toMatch(/SCHEMA DRIFT/);
    expect(out).toMatch(/snuck_in/);
  });

  it('never uses a pg_dump older than the server major version', () => {
    // Simulating "no pg_dump >= 17 anywhere" is not portable: the script probes absolute paths
    // (/opt/homebrew/opt/postgresql@17/bin, /usr/lib/postgresql/17/bin) that a test cannot hide, and
    // emptying PATH just breaks the sed/awk the script needs. So assert the property that actually
    // matters instead: an old binary offered via $PG_DUMP is REJECTED, never invoked.
    const root = makeTree('old-client');
    const marker = join(root, 'old-pg_dump-was-invoked');
    const stub = join(root, 'stub-old');
    writeFileSync(
      stub,
      '#!/bin/sh\n[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) 14.18"; exit 0; }\n' +
        `touch "${marker}"\nexit 0\n`,
    );
    chmodSync(stub, 0o755);

    const { code, out } = run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stub });

    // The old binary must not have produced the dump.
    expect(existsSync(marker)).toBe(false);
    // Either outcome proves rejection: no v17+ client exists here (exit 2, "pg_dump >= 17"), or one
    // was found and used, and then failed to reach the deliberately-dead FAKE_URL (exit 2, dump
    // failed). What must never happen is a successful capture from the 14.18 stub.
    expect(code).toBe(2);
    expect(out).toMatch(/pg_dump >= 17|pg_dump failed/);
  });
});

/**
 * `capture` prints an object-level summary of what changed. This is the mechanization of the
 * "review the hunk" discipline that ddl-governance.md §5 admits is the control's weak point: an
 * 8,781-line generated dump does not get read, six lines do.
 */
describe('schema-baseline.sh capture — object-level change summary', () => {
  const V1 = pgDump([
    { name: 'a', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.a (', '    id uuid NOT NULL', ');'] },
    { name: 'a tenant_isolation', type: 'POLICY', schema: 'public', body: ['CREATE POLICY tenant_isolation ON public.a USING (true);'] },
  ]);

  it('reports no schema change when only the capture timestamp moved', () => {
    const root = makeTree('summary-nochange');
    const stub = stubEmitting(root, 'v1', V1);
    const env = { DIRECT_URL: FAKE_URL, PG_DUMP: stub };
    expect(run(root, ['capture'], env).code).toBe(0);

    const second = run(root, ['capture'], env);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/No schema change/);
  });

  it('names an added table, an added policy and an added grant', () => {
    const root = makeTree('summary-change');
    expect(run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stubEmitting(root, 'v1', V1) }).code).toBe(0);

    const v2 = stubEmitting(root, 'v2', [
      ...V1,
      ...pgDump([
        { name: 'zz_snuck_in', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.zz_snuck_in (', '    id uuid NOT NULL', ');'] },
        // The #111 shape: a second PERMISSIVE policy that ORs past the fail-closed guard.
        { name: 'a allow_all', type: 'POLICY', schema: 'public', body: ['CREATE POLICY allow_all ON public.a USING (true);'] },
        { name: 'TABLE zz_snuck_in', type: 'ACL', schema: 'public', body: ['GRANT SELECT ON TABLE public.zz_snuck_in TO app_tenant;'] },
      ], false),
    ]);
    const { code, out } = run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: v2 });

    expect(code).toBe(0);
    expect(out).toMatch(/\+ TABLE public\.zz_snuck_in$/m);
    expect(out).toMatch(/\+ POLICY public\.a allow_all$/m);
    expect(out).toMatch(/\+ ACL public\.TABLE zz_snuck_in$/m);
    expect(out).toMatch(/3 changed object\(s\): \+3 added, -0 removed, ~0 modified/);
    // The summary must not bury the change — it is the whole reason the summary exists.
    expect(out).toMatch(/STOP/);
  });
});

/**
 * The banned-policy-function assertion added to check 14 (#115) is a live DB check, so its POSITIVE
 * case cannot be exercised without creating a bad policy in production. What can and must be tested
 * offline is its matching rule — because the naive version of it produced a false reading during the
 * #115 investigation ("100 policies use current_org_id", actual answer: 0).
 *
 * Mirrors the regex in scripts/security/verify-rls-isolation.ts. If that regex changes, change this.
 */
describe('banned-policy-function matcher — must not repeat the #115 false positive', () => {
  const matches = (qual: string): boolean => new RegExp('\\bcurrent_org_id\\s*\\(').test(qual);

  it('flags a policy that calls current_org_id()', () => {
    expect(matches('(organization_id = current_org_id())')).toBe(true);
    expect(matches('(organization_id = current_org_id ())')).toBe(true);
    expect(matches('((organization_id = current_org_id()) OR (current_org_id() IS NULL))')).toBe(true);
  });

  it('does NOT flag the correct GUC idiom, whose text contains the function name', () => {
    // This is the exact string that caused the false positive: 'app.current_org_id' as a GUC KEY.
    const correct = "(organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)";
    expect(matches(correct)).toBe(false);
  });

  it('does not flag the parent-subquery variant used on join tables', () => {
    const subquery =
      'EXISTS ( SELECT 1 FROM roles par WHERE ((par.id = user_roles.role_id) AND ' +
      "(par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))";
    expect(matches(subquery)).toBe(false);
  });
});

describe('guard-prod-ddl.sh — refuses schema mutation against a non-local host', () => {
  const GUARD = join(REPO_ROOT, 'scripts', 'db', 'guard-prod-ddl.sh');

  function guard(env: Record<string, string | undefined>, ...args: string[]): Run {
    try {
      const out = execFileSync('bash', [GUARD, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'test', ...env },
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  const PROD = 'postgresql://u:p@aws-1-us-west-2.pooler.supabase.com:5432/postgres';
  const LOCAL = 'postgresql://u:p@localhost:5432/tims';

  it('refuses db push when both URLs point at production', () => {
    const { code, out } = guard({ DATABASE_URL: PROD, DIRECT_URL: PROD }, 'prisma', 'db', 'push');
    expect(code).toBe(1);
    expect(out).toMatch(/REFUSED/);
  });

  it('refuses when only DIRECT_URL is remote — DDL follows directUrl, not DATABASE_URL', () => {
    const { code } = guard({ DATABASE_URL: LOCAL, DIRECT_URL: PROD }, 'prisma', 'db', 'push');
    expect(code).toBe(1);
  });

  it('refuses migrate dev and migrate deploy, not just db push', () => {
    expect(guard({ DATABASE_URL: PROD, DIRECT_URL: PROD }, 'prisma', 'migrate', 'dev').code).toBe(1);
    expect(guard({ DATABASE_URL: PROD, DIRECT_URL: PROD }, 'prisma', 'migrate', 'deploy').code).toBe(1);
  });

  it('cannot be sidestepped by whitespace padding in the arguments', () => {
    // `prisma db  push` (double space) bypassed the substring match before whitespace collapsing.
    expect(guard({ DATABASE_URL: PROD, DIRECT_URL: PROD }, 'prisma', 'db ', ' push').code).toBe(1);
    expect(guard({ DATABASE_URL: PROD, DIRECT_URL: PROD }, 'prisma', 'db', '', 'push').code).toBe(1);
    expect(guard({ DATABASE_URL: PROD, DIRECT_URL: PROD }, 'prisma', 'migrate', ' dev').code).toBe(1);
  });

  it('fails closed when no URL is set — an unknown target is not a safe target', () => {
    const { code, out } = guard(
      { DATABASE_URL: undefined, DIRECT_URL: undefined, HOME: sandbox },
      'prisma',
      'db',
      'push',
    );
    expect(code).toBe(1);
    expect(out).toMatch(/REFUSED/);
  });

  it('allows a mutating command against localhost', () => {
    const { code, out } = guard({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }, 'echo', 'db push ok');
    expect(code).toBe(0);
    expect(out).toMatch(/db push ok/);
  });

  it('passes read-only prisma commands straight through, even pointed at production', () => {
    const { code, out } = guard({ DATABASE_URL: PROD, DIRECT_URL: PROD }, 'echo', 'generate ok');
    expect(code).toBe(0);
    expect(out).toMatch(/generate ok/);
  });
});

/**
 * #328 review (MEDIUM-1): the repository is PUBLIC, so whatever the nightly job prints is public. In CI
 * (GITHUB_ACTIONS=true) or with SCHEMA_DRIFT_OBJECTS_ONLY=1 the script names changed OBJECTS only and never
 * echoes a verbatim schema line — a function body changed out of band could carry anything.
 *
 * #336 tier-1 review: objects are identified by pg_dump's own TOC headers, not by parsing SQL. The fixtures
 * under tests/db/fixtures/pg-dump-17 are REAL pg_dump 17.10 output (a throwaway local cluster, before and
 * after: a column added, a single-line function body changed, a GRANT widened to a comma list, a function
 * with an apostrophe in its name and an E'' literal containing `--`, a multi-line table comment). Only the
 * random `\restrict` nonce was replaced by a fixed placeholder. Every dump shape the earlier SQL lexer
 * missed is in them.
 */
describe('schema-baseline.sh — objects-only output for public CI logs', () => {
  const FIXTURES = join(REPO_ROOT, 'tests', 'db', 'fixtures', 'pg-dump-17');
  const REAL_V1 = readFileSync(join(FIXTURES, 'v1.sql'), 'utf8').replace(/\n$/, '').split('\n');
  const REAL_V2 = readFileSync(join(FIXTURES, 'v2.sql'), 'utf8').replace(/\n$/, '').split('\n');
  const SYNTHETIC = /SYNTHETIC_[A-Z]+_\d+|synthetic_col_778/;

  /** Commits the tree's baseline as git HEAD: objects-only mode prints only names committed there. */
  function commitBaseline(root: string): void {
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
        { cwd: root, stdio: 'ignore' },
      );
    git('init', '-q');
    git('add', BASELINE_REL);
    git('commit', '-q', '--no-verify', '-m', 'baseline');
  }

  function driftCheck(name: string, before: string[], after: string[], env: Record<string, string>, commit = true): Run {
    const root = makeTree(name);
    expect(run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stubEmitting(root, 'before', before) }).code).toBe(0);
    if (commit) commitBaseline(root);
    return run(root, ['check'], { DIRECT_URL: FAKE_URL, PG_DUMP: stubEmitting(root, 'after', after), ...env });
  }

  for (const [label, env] of [
    ['SCHEMA_DRIFT_OBJECTS_ONLY=1', { SCHEMA_DRIFT_OBJECTS_ONLY: '1' }],
    ['GITHUB_ACTIONS=true', { GITHUB_ACTIONS: 'true' }],
  ] as const) {
    it(`check under ${label}: real pg_dump shapes are all named, and no schema text is printed`, () => {
      const { code, out } = driftCheck(`oo-real-${label.replace(/\W/g, '')}`, REAL_V1, REAL_V2, env);
      expect(code).toBe(1);
      expect(out).toMatch(/SCHEMA DRIFT/);
      // Column-only change inside CREATE TABLE → the TABLE entry.
      expect(out).toMatch(/^ {2}~ TABLE public\.t$/m);
      // Single-line body `AS $$SELECT 2 ...$$;` → the FUNCTION entry.
      expect(out).toMatch(/^ {2}~ FUNCTION public\.f\(\)$/m);
      // `GRANT SELECT,UPDATE ON TABLE ...` → the ACL entry.
      expect(out).toMatch(/^ {2}~ ACL public\.TABLE t$/m);
      // NEW entries exist only in the live dump, so their names are withheld: type + hash only.
      expect(out).toMatch(/^ {2}\+ FUNCTION \[name withheld, sha256:[0-9a-f]{12}\]$/m);
      expect(out).toMatch(/^ {2}\+ COMMENT \[name withheld, sha256:[0-9a-f]{12}\]$/m);
      expect(out).not.toMatch(/clock/);
      expect(out).toMatch(/5 changed object\(s\): \+2 added, -0 removed, ~3 modified/);
      expect(out).toMatch(/objects-only mode: no schema text printed/);
      expect(out).not.toMatch(SYNTHETIC);
      // Nothing that only occurs inside a dump statement may appear at all.
      expect(out).not.toMatch(/SELECT|GRANT|CREATE|COMMENT ON|E'it/);
    });
  }

  it('every line the check prints is a fixed message, a TOC identity, or a count (no verbatim dump line)', () => {
    const { out } = driftCheck('oo-allowlist', REAL_V1, REAL_V2, { SCHEMA_DRIFT_OBJECTS_ONLY: '1' });
    const dumpLines = new Set([...REAL_V1, ...REAL_V2].map((l) => l.trim()).filter((l) => l.length > 3));
    for (const line of out.split('\n')) expect(dumpLines.has(line.trim())).toBe(false);
  });

  it('hostile body text never reaches the log, however it is quoted or commented', () => {
    const before = pgDump([{ name: 't', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.t (', '    id uuid NOT NULL', ');'] }]);
    const after = [
      ...before,
      ...pgDump(
        [
          {
            name: 'g()',
            type: 'FUNCTION',
            schema: 'public',
            body: [
              'CREATE FUNCTION public.g() RETURNS void',
              '    LANGUAGE plpgsql',
              '    AS $_1$',
              'BEGIN',
              `CREATE TABLE "${'gh' + 'p_'}SYNTHETIC_CREDENTIAL_1234567890" (x int);`,
              "  PERFORM E'\\' -- SYNTHETIC_ESCAPE_77';",
              '  /* GRANT ALL ON TABLE public.t TO SYNTHETIC_ROLE_88 */',
              "  PERFORM '@@obj@@ Bearer SYNTHETIC_SECRET_12345678';",
              // A forged header WITHOUT pg_dump's bracketing `--` lines is just body text.
              '-- Name: SYNTHETIC_FORGED_55; Type: TABLE; Schema: public; Owner: postgres',
              'END',
              '$_1$;',
            ],
          },
        ],
        false,
      ),
    ];
    const { code, out } = driftCheck('oo-hostile', before, after, { SCHEMA_DRIFT_OBJECTS_ONLY: '1' });
    expect(code).toBe(1);
    expect(out).toMatch(/^ {2}\+ FUNCTION \[name withheld, sha256:[0-9a-f]{12}\]$/m);
    expect(out).toMatch(/1 changed object\(s\)/);
    expect(out).not.toMatch(SYNTHETIC);
  });

  it('a COMPLETE forged TOC banner inside a body cannot print its text (tier-1 round 1)', () => {
    // pg_dump's header is recognised by shape, so this body DOES open a pseudo-entry. What must hold is that
    // nothing from it is printed: a name that is not in the committed baseline is withheld.
    const token = `${'gh' + 'p_'}SYNTHETIC_CREDENTIAL_12345678901234567890`;
    const before = pgDump([{ name: 't', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.t ();'] }]);
    const forged = (type: string) => [
      ...before,
      ...pgDump(
        [
          {
            name: 'g()',
            type: 'FUNCTION',
            schema: 'public',
            body: [
              'CREATE FUNCTION public.g() RETURNS text LANGUAGE sql AS $body$',
              'SELECT $embedded$',
              '--',
              `-- Name: ${token}; Type: ${type}; Schema: public; Owner: postgres`,
              '--',
              '$embedded$;',
              '$body$;',
            ],
          },
        ],
        false,
      ),
    ];
    for (const type of ['TABLE', `${'gh' + 'p_'}SYNTHETIC_TYPE_998877`]) {
      for (const env of [{ SCHEMA_DRIFT_OBJECTS_ONLY: '1' }, { GITHUB_ACTIONS: 'true' }]) {
        const { code, out } = driftCheck(`oo-forged-${type.length}-${Object.keys(env)[0]}`, before, forged(type), env);
        expect(code).toBe(1);
        expect(out).not.toMatch(SYNTHETIC);
        expect(out).not.toMatch(/gh[p]_/);
        // An unrecognised type word is not echoed either.
        expect(out).toMatch(/^ {2}\+ (TABLE|OTHER) \[name withheld, sha256:[0-9a-f]{12}\]$/m);
      }
    }
  });

  it('capture under objects-only mode withholds new names too (its summary is tee-d to the public log)', () => {
    const root = makeTree('oo-capture');
    expect(run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stubEmitting(root, 'v1', REAL_V1) }).code).toBe(0);
    commitBaseline(root);
    const { code, out } = run(root, ['capture'], {
      DIRECT_URL: FAKE_URL,
      PG_DUMP: stubEmitting(root, 'v2', REAL_V2),
      SCHEMA_DRIFT_OBJECTS_ONLY: '1',
    });
    expect(code).toBe(0);
    expect(out).toMatch(/^ {2}~ TABLE public\.t$/m);
    expect(out).toMatch(/^ {2}\+ FUNCTION \[name withheld, sha256:[0-9a-f]{12}\]$/m);
    expect(out).not.toMatch(SYNTHETIC);
    expect(out).not.toMatch(/clock/);
  });

  it('capture-then-drift: a name the capture just wrote is NOT trusted by the round-trip check (tier-1 round 2)', () => {
    // The capture job runs `capture` (overwriting the baseline file with an unreviewed dump) and then `check`.
    // A name that exists only in that fresh capture must stay withheld even though it is now on the OLD side.
    const token = `${'gh' + 'p_'}SYNTHETIC_FRESH_NAME_12345678901234567890`;
    const root = makeTree('oo-capture-then-drift');
    const v1 = pgDump([{ name: 't', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.t ();'] }]);
    expect(run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: stubEmitting(root, 'v1', v1) }).code).toBe(0);
    commitBaseline(root);
    const fn = (n: number) => [
      ...v1,
      ...pgDump([{ name: `${token}()`, type: 'FUNCTION', schema: 'public', body: [`CREATE FUNCTION public.${token}() RETURNS int LANGUAGE sql AS $$SELECT ${n}$$;`] }], false),
    ];
    const env = { DIRECT_URL: FAKE_URL, SCHEMA_DRIFT_OBJECTS_ONLY: '1' };
    const captured = run(root, ['capture'], { ...env, PG_DUMP: stubEmitting(root, 'v2', fn(1)) });
    expect(captured.code).toBe(0);
    expect(captured.out).not.toMatch(SYNTHETIC);
    for (const after of [fn(2), v1]) {
      const { code, out } = run(root, ['check'], { ...env, PG_DUMP: stubEmitting(root, `v3-${after.length}`, after) });
      expect(code).toBe(1);
      expect(out).toMatch(/^ {2}[~-] FUNCTION \[name withheld, sha256:[0-9a-f]{12}\]$/m);
      expect(out).not.toMatch(SYNTHETIC);
    }
  });

  it('outside a git checkout no name is trusted: every identity is withheld', () => {
    const { code, out } = driftCheck('oo-no-git', REAL_V1, REAL_V2, { SCHEMA_DRIFT_OBJECTS_ONLY: '1' }, false);
    expect(code).toBe(1);
    expect(out).toMatch(/^ {2}~ TABLE \[name withheld, sha256:[0-9a-f]{12}\]$/m);
    expect(out).toMatch(/^ {2}~ ACL \[name withheld, sha256:[0-9a-f]{12}\]$/m);
    expect(out).not.toMatch(/public\.t/);
  });

  it('a body-only change is reported by its entry identity, never by its text', () => {
    const fn = (ret: string) =>
      pgDump([
        { name: 'answer()', type: 'FUNCTION', schema: 'public', body: ['CREATE FUNCTION public.answer() RETURNS integer', '    LANGUAGE sql', `    AS $$SELECT ${ret}$$;`] },
      ]);
    const { code, out } = driftCheck('oo-body-change', fn('41'), fn('424242'), { SCHEMA_DRIFT_OBJECTS_ONLY: '1' });
    expect(code).toBe(1);
    expect(out).toMatch(/^ {2}~ FUNCTION public\.answer\(\)$/m);
    expect(out).not.toMatch(/424242/);
  });

  it('a removed entry is reported with "-", and preamble-only changes are attributed, not dropped', () => {
    const gone = { name: 'gone', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.gone (', '    id int', ');'] };
    const kept = { name: 'kept', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.kept (', '    id int', ');'] };
    const after = pgDump([kept]).map((l) => (l === 'SET lock_timeout = 0;' ? 'SET SYNTHETIC_SETTING_31 = on;' : l));
    const { code, out } = driftCheck('oo-removed', pgDump([gone, kept]), after, { SCHEMA_DRIFT_OBJECTS_ONLY: '1' });
    expect(code).toBe(1);
    expect(out).toMatch(/^ {2}- TABLE public\.gone$/m);
    expect(out).toMatch(/^ {2}~ \(dump preamble\)$/m);
    expect(out).not.toMatch(SYNTHETIC);
  });

  it('locally, an identity is reduced to a safe character set and truncated', () => {
    const before = pgDump([{ name: 't', type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.t ();'] }]);
    const weird = `x$'\`;|&<>{}%${'A'.repeat(300)}`;
    const after = [...before, ...pgDump([{ name: weird, type: 'TABLE', schema: 'public', body: ['CREATE TABLE public.x ();'] }], false)];
    // Local mode: the only mode that prints a NEW entry's name.
    const { out } = driftCheck('oo-sanitise', before, after, {});
    const line = out.split('\n').find((l) => l.startsWith('  + TABLE public.x'));
    expect(line).toBeDefined();
    expect(line).toMatch(/^ {2}\+ TABLE public\.x\?{11}A+$/);
    expect((line ?? '').length).toBeLessThanOrEqual(2 + 2 + 120);
  });

  it('positive control: locally (no CI env) check names the objects AND prints the verbatim diff', () => {
    const { code, out } = driftCheck('oo-local', REAL_V1, REAL_V2, {});
    expect(code).toBe(1);
    expect(out).toMatch(/^ {2}~ TABLE public\.t$/m);
    expect(out).toMatch(/^ {2}\+ FUNCTION public\.o\?clock\(\)$/m);
    expect(out).toMatch(/SYNTHETIC_BODY_991/);
  });
});
