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
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    const { code, out } = run(root, ['check'], { DIRECT_URL: undefined, DATABASE_URL: undefined });
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
    const { code } = run(root, ['definitely-not-a-command'], { DIRECT_URL: FAKE_URL });
    expect(code).toBe(2);
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
  /** A stub emitting a fixed schema, so "prod changed" can be simulated by swapping stubs. */
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

  const V1 = ['CREATE TABLE public.a (id uuid NOT NULL);', 'CREATE POLICY tenant_isolation ON public.a USING (true);'];

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
      'CREATE TABLE public.zz_snuck_in (id uuid NOT NULL);',
      // The #111 shape: a second PERMISSIVE policy that ORs past the fail-closed guard.
      'CREATE POLICY allow_all ON public.a USING (true);',
      'GRANT SELECT ON public.zz_snuck_in TO app_tenant;',
    ]);
    const { code, out } = run(root, ['capture'], { DIRECT_URL: FAKE_URL, PG_DUMP: v2 });

    expect(code).toBe(0);
    expect(out).toMatch(/CREATE TABLE public\.zz_snuck_in/);
    expect(out).toMatch(/CREATE POLICY allow_all ON public\.a/);
    expect(out).toMatch(/GRANT SELECT ON public\.zz_snuck_in TO app_tenant/);
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
