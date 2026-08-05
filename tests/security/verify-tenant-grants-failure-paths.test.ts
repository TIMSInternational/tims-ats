/**
 * Regression tests for the FAILURE paths of scripts/security/verify-tenant-grants.ts (/gate check 17).
 *
 * WHY THESE EXIST
 * ---------------
 * Same doctrine as `tests/db/schema-baseline-failure-paths.test.ts` (#115), applied to the privilege
 * check. #38 is the precedent: the Codex CLI exits 0 when quota-blocked, so a mandated gate silently
 * no-opped for weeks while every build reported green. A privilege check with that defect is worse than
 * none — it certifies grants it never read.
 *
 * The contract under test is the exit code:
 *
 *   0  ran, `app_tenant` holds write privileges only where it legitimately may
 *   1  ran, found a violation
 *   2  COULD NOT RUN — never to be reported as a pass
 *
 * Exit 2 is new as of #124. The script previously returned 1 for BOTH a violation and a could-not-run,
 * which made #124's own acceptance criterion ("the job must distinguish exit 1 from exit 2 and fail
 * loudly on 2") unsatisfiable for it. These tests are what stop that from silently regressing.
 *
 * WHAT IS NOT COVERED, stated because a partially-pinned contract invites the wrong confidence
 * ------------------------------------------------------------------------------------------
 * Exit 0 and **exit 1 (found a violation)** are not exercised here — both need a live database. `/gate`
 * check 17 covers exit 0 against prod every ship. **Nothing covers exit 1**, which a tier-2 reviewer
 * rightly flagged: a refactor turning the violation branch into a `throw` would silently convert
 * violations into exit 2, re-collapsing the very two states this suite exists to separate, and every test
 * below would still pass.
 *
 * Deliberately not fixed here. Covering it needs a throwaway Postgres cluster (initdb + a real
 * `app_tenant` role + a granted table), which would make `npx vitest run` — /gate check 3, the suite
 * everyone runs — depend on a local PostgreSQL 17 install. That trade is worse than the gap: a test
 * everybody skips protects nothing. Tracked as a follow-up on #124, whose CI job can use a Postgres
 * service container and is the right home for it.
 *
 * HOW THIS STAYS OFFLINE, AND WHY IT TESTS THE REAL FILE
 * -----------------------------------------------------
 * The script is run unmodified from its real path, with `cwd` pointed at a throwaway directory. That
 * works because of an asymmetry in how it resolves things:
 *   - the Prisma schema (`packages/db/prisma/schema`) and the `.env` files are resolved from **cwd**,
 *     so the sandbox controls both;
 *   - its `../table-ownership.mjs` import is resolved from the **script's own location**, so the real
 *     parser is exercised.
 * No copying, no symlinks, and no chance of the assertions passing against a stale copy. Credentials are
 * stripped from the child environment, and the one URL supplied points at a closed loopback port.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'scripts/security/verify-tenant-grants.ts');
const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx');
const SCHEMA_REL = 'packages/db/prisma/schema';

/** Port 1 on loopback: nothing listens there, so the connection fails without reaching any database. */
const DEAD_URL = 'postgresql://nobody:nothing@127.0.0.1:1/none';

/** One real model, so the parser returns a non-empty set and the run proceeds past the schema guard. */
const ONE_MODEL = 'model Thing {\n  id String @id\n\n  @@map("things")\n}\n';

let sandbox: string;

/** A cwd with a Prisma schema directory that is either populated or deliberately empty. */
function makeCwd(name: string, schema: string | null): string {
  const root = join(sandbox, name);
  mkdirSync(join(root, SCHEMA_REL), { recursive: true });
  if (schema !== null) writeFileSync(join(root, SCHEMA_REL, 'test.prisma'), schema);
  return root;
}

type Run = { code: number; out: string };

function run(cwd: string, env: Record<string, string | undefined>): Run {
  try {
    const out = execFileSync(TSX, [SCRIPT], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Strip inherited DB credentials. Without this a developer's real .env turns an expected exit 2
      // into a live production query — the same trap the schema-baseline failure tests call out.
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
  sandbox = mkdtempSync(join(tmpdir(), 'tenant-grants-test-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('verify-tenant-grants.ts — exit 2 means DID NOT RUN, never a pass', () => {
  it("resolves .env relative to CWD — the property this suite's offline safety depends on", () => {
    // Tier-2 finding on this PR, and a fair one: the suite is only offline because `loadDbEnv` reads the
    // BARE relative paths 'packages/db/.env' and '.env', which Node resolves from cwd. Nothing pinned that.
    // If it were ever changed to resolve from the script's own directory, the "no URL" test below would
    // silently pick up a developer's real DIRECT_URL and fire a query at PRODUCTION.
    //
    // So pin it: drop a .env carrying a DEAD url into the sandbox cwd and assert the script consumed it.
    // Reaching the connection stage proves cwd-relative resolution; the dead URL keeps it harmless.
    //
    // THIS TEST RUNS FIRST ON PURPOSE. Vitest executes in file order, so if someone does switch the
    // resolution, this fails before the "no URL" test gets a chance to reach a real database. Reordering
    // it below the others reopens that window — the assertion is the same, the safety is not.
    const cwd = makeCwd('env-from-cwd', ONE_MODEL);
    mkdirSync(join(cwd, 'packages/db'), { recursive: true });
    writeFileSync(join(cwd, 'packages/db/.env'), `DIRECT_URL=${DEAD_URL}\n`);

    const { code, out } = run(cwd, {});
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    // If resolution were NOT cwd-relative, the sandbox .env would be invisible and we would instead see
    // the no-URL message. Seeing a connection failure is the positive signal.
    expect(out, 'the sandbox .env was not read — .env resolution is no longer cwd-relative').not.toMatch(
      /no DIRECT_URL or DATABASE_URL/,
    );
    expect(out).toMatch(/DID NOT RUN/);
  });

  it('exits 2 when no connection URL is resolvable', () => {
    const { code, out } = run(makeCwd('no-url', ONE_MODEL), {});
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).toMatch(/DIRECT_URL or DATABASE_URL/);
    expect(out).toMatch(/not a pass/);
  });

  it('exits 2 when the Prisma schema parses to zero tables', () => {
    // An empty schema directory would make every non-Prisma table look like a violation. Emitting ~99
    // false positives is not "found problems", it is a broken input — and a check that cries wolf at
    // that volume gets switched off, which is worse than not having it.
    const { code, out } = run(makeCwd('zero-tables', null), { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).toMatch(/ZERO tables/);
  });

  it('exits 2 — not 1 — when the database is unreachable', () => {
    // The regression this pins most directly. Before #124 this path exited 1, identical to "found a
    // violation", so an automated job could not tell a privilege breach from a network blip.
    const { code, out } = run(makeCwd('dead-connection', ONE_MODEL), { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).not.toMatch(/least privilege intact/);
  });

  it('emits no success sentence on any could-not-run path', () => {
    // The property that matters independently of exit codes: no failure path may print the success line.
    // If a refactor lets a die-path fall through to the happy message, this catches it even if the exit
    // code still happens to be 2.
    const cases = [
      { name: 'no-url', cwd: () => makeCwd('sweep-no-url', ONE_MODEL), env: {} },
      { name: 'zero-tables', cwd: () => makeCwd('sweep-zero', null), env: { DIRECT_URL: DEAD_URL } },
      { name: 'unreachable', cwd: () => makeCwd('sweep-dead', ONE_MODEL), env: { DIRECT_URL: DEAD_URL } },
    ];
    for (const c of cases) {
      const { code, out } = run(c.cwd(), c.env);
      expect(code, `${c.name}: expected exit 2`).toBe(2);
      expect(out, `${c.name}: must not claim success`).not.toMatch(/✓/);
    }
  });
});
