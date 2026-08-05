/**
 * Regression tests for the FAILURE paths of scripts/security/verify-rls-isolation.ts (/gate check 14).
 *
 * WHY THESE EXIST
 * ---------------
 * Check 14 is the control that caught #111 — two out-of-band policy families that made an unset org GUC
 * return every tenant's rows. It is the most important assertion this repo makes about tenant isolation,
 * and until #124 it had **no failure-path coverage at all**, plus the same two defects check 17 turned out
 * to have:
 *
 *   - it returned exit 1 for both "found a violation" and "never ran", so no automated caller could tell
 *     a tenant-isolation breach from a network blip;
 *   - it could report a VACUOUS PASS. The empirical probe skips empty tables ("an empty table proves
 *     nothing either way", which is true) but never escalated that to the obvious corollary: if EVERY
 *     table is empty, or there are no RLS tables at all, the loop does nothing, `findings` stays empty,
 *     and the script prints "✓ RLS tenant isolation verified" against a database it never examined.
 *
 * Contract under test:
 *
 *   0  ran, isolation holds
 *   1  ran, found a finding
 *   2  COULD NOT RUN — never to be reported as a pass
 *
 * WHAT IS AND IS NOT COVERED HERE
 * -------------------------------
 * Offline: the no-URL path, the unreachable-database path, and the property that no failure path prints
 * the success sentence.
 *
 * NOT offline, and therefore not here: exit 0, exit 1, and the two vacuity guards (zero RLS tables /
 * all tables empty) — every one needs a live PostgreSQL. Covering them in this suite would make
 * `npx vitest run` depend on a local PostgreSQL 17 install, and a test everybody skips protects nothing.
 * They were verified by hand against a throwaway PG17 cluster when they landed, and #124's CI job (which
 * can use a Postgres service container) is the right home for automating them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'scripts/security/verify-rls-isolation.ts');
const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx');

/** Port 1 on loopback: nothing listens there, so the connection fails without reaching any database. */
const DEAD_URL = 'postgresql://nobody:nothing@127.0.0.1:1/none';

let sandbox: string;

beforeAll(() => {
  // Fail with a sentence someone can act on. Without this the spawn below dies as `exit -1` with empty
  // output, which reads like a bug in the script under test — it cost real time once already, after a
  // branch switch to a commit predating the tsx dependency pruned the binary.
  expect(
    existsSync(TSX),
    `${TSX} is missing. tsx is a declared devDependency (#124) — run \`pnpm install --frozen-lockfile\`. ` +
      'This is an environment problem, not a failure of the script under test.',
  ).toBe(true);
  sandbox = mkdtempSync(join(tmpdir(), 'rls-isolation-test-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * A cwd with no `.env` anywhere, so the script's cwd-relative lookup finds nothing.
 *
 * The script resolves the BARE relative paths 'packages/db/.env' and '.env', which Node resolves from cwd
 * — that is the whole reason this suite can stay offline, and the reason the first test below pins it.
 */
function makeCwd(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(root, { recursive: true });
  return root;
}

type Run = { code: number; out: string };

function run(cwd: string, env: Record<string, string | undefined>): Run {
  try {
    const out = execFileSync(TSX, [SCRIPT], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Strip inherited credentials: without this a developer's real DIRECT_URL turns an expected exit 2
      // into a live production query.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        DIRECT_URL: undefined,
        DATABASE_URL: undefined,
        ...env,
      },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('verify-rls-isolation.ts — exit 2 means DID NOT RUN, never a pass', () => {
  it("resolves .env relative to CWD — the property this suite's offline safety depends on", () => {
    // RUNS FIRST ON PURPOSE. If `loadDbEnv` were ever changed to resolve from the script's own directory,
    // the no-URL test below would silently pick up a real DIRECT_URL and query PRODUCTION. Vitest executes
    // in file order, so pinning it here means that change fails before the risky test runs.
    const cwd = makeCwd('env-from-cwd');
    mkdirSync(join(cwd, 'packages/db'), { recursive: true });
    writeFileSync(join(cwd, 'packages/db/.env'), `DIRECT_URL=${DEAD_URL}\n`);

    const { code, out } = run(cwd, {});
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    // Reaching a connection failure (rather than the no-URL message) proves the sandbox .env was read.
    expect(out, 'the sandbox .env was not read — .env resolution is no longer cwd-relative').not.toMatch(
      /no DIRECT_URL or DATABASE_URL/,
    );
    expect(out).toMatch(/DID NOT RUN/);
  });

  it('exits 2 when no connection URL is resolvable', () => {
    const { code, out } = run(makeCwd('no-url'), {});
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).toMatch(/DIRECT_URL or DATABASE_URL/);
    expect(out).toMatch(/not a pass/);
  });

  it('exits 2 — not 1 — when the database is unreachable', () => {
    // The regression this pins most directly. Before #124 this path exited 1, identical to "found an
    // isolation finding", so an automated job could not tell a tenant-isolation breach from a network blip.
    const { code, out } = run(makeCwd('dead-connection'), { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).not.toMatch(/isolation verified/);
  });

  it('emits no success sentence on any could-not-run path', () => {
    // Independent of exit codes: no failure path may print the success line. Catches a refactor that lets
    // a die-path fall through to the happy message even if the exit code still happens to be 2.
    for (const c of [
      { name: 'no-url', cwd: () => makeCwd('sweep-no-url'), env: {} },
      { name: 'unreachable', cwd: () => makeCwd('sweep-dead'), env: { DIRECT_URL: DEAD_URL } },
    ]) {
      const { code, out } = run(c.cwd(), c.env);
      expect(code, `${c.name}: expected exit 2`).toBe(2);
      expect(out, `${c.name}: must not claim success`).not.toMatch(/✓/);
    }
  });
});
