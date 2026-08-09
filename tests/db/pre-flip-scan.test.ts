/**
 * #132 — FAILURE-PATH tests for `scripts/db/pre-flip-scan.ts`, plus property pins for the arms that
 * cannot run without a database.
 *
 * THE CONTRACT UNDER TEST
 *   0  ran, no blocker
 *   1  ran, found a blocker
 *   2  COULD NOT RUN — never to be reported as a pass
 *
 * Checks 14, 16 and 17 each shipped with a vacuous pass that certified a database they never examined,
 * and each had to be fixed afterwards. This scan is the fourth control of that family, so its could-not-run
 * paths are EXECUTED here — against the real script, from its real path — rather than asserted about its
 * source text. Everything below runs offline: the sandbox cwds carry no credentials and the one URL
 * supplied points at a closed loopback port.
 *
 * WHAT WAS PROVED AGAINST A REAL CLUSTER, AND IS NOT AUTOMATED HERE
 * ----------------------------------------------------------------
 * Exit 0 and exit 1 need a live database, so they were exercised by hand on a throwaway PostgreSQL 17.10
 * cluster (`initdb` + `pg_ctl` on 127.0.0.1:55436, torn down afterwards) carrying the real Prisma schema
 * via `prisma db push` (96 tables) plus deliberate readers over `surveys` / `survey_responses`:
 *
 *   - EMPTY database                    → exit 2, "only 0 of the 96 tables declared by the Prisma schema
 *                                          exist in this database". NOT a tick. This was the first thing
 *                                          checked, because it is the question the whole rewrite answers.
 *   - view + matview + plpgsql function
 *     + trigger + §3(f) policy + FK      → exit 1, 6 blockers, every arm firing
 *   - after dropping them                → exit 0, and the summary NAMES the arms whose population was
 *                                          empty instead of printing an unqualified tick
 *   - MUTATION: the functions arm's predicate changed from `p.prosrc ~* $1` to
 *     `p.prosrc ~* ('zzzz' || $1)`       → exit 2, "1 arm(s) could not prove their matcher against a row
 *                                          that MUST match: functions". With the guard ALSO removed, the
 *                                          same mutant printed "functions referencing it  none" and
 *                                          exited 1 with five blockers instead of six — i.e. it silently
 *                                          lost a real reader. That pair is the whole argument for the
 *                                          matcher proofs.
 *   - SQL-STANDARD-BODY function
 *     (`LANGUAGE sql BEGIN ATOMIC
 *      SELECT count(*) FROM critical_roles;
 *      END`)                             → measured on a throwaway PG 17.10 cluster alongside a `plpgsql`
 *                                          and a dollar-quoted `LANGUAGE sql` control: its `prosrc` is
 *                                          `''`, so the pre-fix `p.prosrc ~* $1` arm returned NOTHING for
 *                                          it, while `pg_depend` DID carry the edge — and because
 *                                          `pg_proc` is in NAMED, that edge printed as INFO under
 *                                          "pg_depend (named classes)" and never reached `blockers`. The
 *                                          scan therefore printed the reader and exited 0. Fixed by
 *                                          searching `prosrc || pg_get_function_sqlbody(oid)`; the
 *                                          population and sample queries had to move with it, or the arm
 *                                          reports population 0 and `proveArm` reads it as NOT EXERCISED,
 *                                          which is a second independent path to a green exit.
 *                                          (`pg_get_function_sqlbody` returns NULL rather than throwing
 *                                          for non-SQL bodies; `pg_get_functiondef` THROWS on aggregates
 *                                          and must not be substituted.)
 *   - `__EFMigrationsHistory`            → found, not a false "does not exist": the existence probe
 *                                          matches `relname` exactly and never folds case.
 *   - a same-named FK constraint in
 *     another schema                     → NOT reported as an inbound FK; `pg_constraint.confrelid` is an
 *                                          OID, so `information_schema`'s non-unique `constraint_name`
 *                                          cannot produce a phantom.
 *   - `--flip-diff` with `surveys` added
 *     to the ledger's `efcore[]`         → derived the table from the diff and blocked on it
 *
 * Making `npx vitest run` depend on a local PostgreSQL 17 install is the trade this repo already
 * declined for check 17, for the good reason that a test everybody skips protects nothing. So the split
 * is deliberate: could-not-run paths execute here, the database paths are pinned as properties, and the
 * transcript above is the record.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockAt } from '../helpers/source-blocks';

const REPO_ROOT = process.cwd();
const SCRIPT_REL = 'scripts/db/pre-flip-scan.ts';
const SCRIPT = join(REPO_ROOT, SCRIPT_REL);
const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx');
const SRC = readFileSync(SCRIPT, 'utf8');

/**
 * The source with comment lines stripped, for the assertions that say a construct must NOT appear.
 *
 * Written after this exact trap fired: the file EXPLAINS in a comment that it no longer uses
 * `to_regclass('public.'||$1)`, and a naive `expect(SRC).not.toMatch(...)` failed on the explanation
 * rather than on the code. A negative pin that a comment can trip is a negative pin that will be
 * "fixed" by deleting the comment, which is the opposite of what anyone wanted.
 */
const CODE = SRC.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

/** Port 1 on loopback: nothing listens there, so the connection fails without reaching any database. */
const DEAD_URL = 'postgresql://nobody:nothing@127.0.0.1:1/none';

/** The data roots the scan pins by name. A sandbox needs all of them or it dies before anything else. */
const ROOTS = ['contracts', 'packages/db/prisma', 'scripts/parity', 'services/Tims.Platform/db'];

let sandbox: string;

type Run = { code: number; out: string };

function run(args: string[], cwd: string, env: Record<string, string | undefined> = {}): Run {
  // Recurrence guard for the live-production-connection defect. Stripping the inherited env (below) is
  // NOT sufficient on its own: loadDbEnv() falls back to the BARE RELATIVE path `packages/db/.env`,
  // resolved against `cwd`. From a sandbox that file does not exist, but from REPO_ROOT it is the real
  // one, holding the production Supabase URL. So REPO_ROOT runs must always pin a URL explicitly.
  // Deliberately NOT a default value for `env` — defaulting it would break the `no DIRECT_URL or
  // DATABASE_URL` assertions (:186, :222) and silently vacate the cwd-resolution pin at :174, which can
  // only observe loadDbEnv() reading a .env when no URL is preset. Sandbox cwds are exempt by design:
  // there is no packages/db/.env under a mkdtemp root, which is what those tests rely on.
  if (cwd === REPO_ROOT && env.DIRECT_URL === undefined && env.DATABASE_URL === undefined) {
    throw new Error(
      'run() from REPO_ROOT without DIRECT_URL/DATABASE_URL: loadDbEnv() would resolve the real ' +
        'packages/db/.env and could open a LIVE PRODUCTION connection. Pass { DIRECT_URL: DEAD_URL }.',
    );
  }
  try {
    const out = execFileSync(TSX, [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Strip inherited DB credentials. Without this a developer's real .env turns an expected exit 2
      // into a live PRODUCTION query — the trap the schema-baseline and tenant-grant failure tests both
      // call out, and the reason the cwd-resolution test below runs first.
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

/** A minimal ownership ledger, in the exact shape `parseLedger` requires (a single ```json block). */
function ledger(efcore: string[]): string {
  return `# ledger\n\n\`\`\`json\n${JSON.stringify({ defaultOwner: 'prisma', efcore }, null, 2)}\n\`\`\`\n`;
}

/** A throwaway cwd with the pinned data roots, optionally populated. */
function makeCwd(
  name: string,
  opts: { roots?: string[]; files?: Record<string, string>; placeholders?: boolean } = {},
): string {
  const root = join(sandbox, name);
  for (const r of opts.roots ?? ROOTS) {
    mkdirSync(join(root, r), { recursive: true });
    // Every root gets at least one matching file. The CLI now die2s on a root that EXISTS but is EMPTY
    // (an existing-but-empty root used to trip neither `missingRoots` nor the repo-wide
    // `filesScanned === 0`, so it silently shrank the search population). A sandbox that creates bare
    // directories therefore no longer models a healthy repo — it models the very defect that guard
    // exists to catch, and would make every downstream test exit 2 for the wrong reason.
    // `.gitkeep`-style placeholders would not do: the file must match the scanner's pinned extensions.
    // `.json` because it is the one extension ALL four DATA_ROOTS accept (contracts also takes
    // yaml/csv, Tims.Platform/db takes sql, the two TS roots take ts — json is the intersection).
    if (opts.placeholders !== false) writeFileSync(join(root, r, '__placeholder.json'), '{}');
  }
  for (const [rel, body] of Object.entries(opts.files ?? {})) {
    mkdirSync(join(root, rel.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

beforeAll(() => {
  expect(
    existsSync(TSX),
    `${TSX} is missing. tsx is a declared devDependency (#124) — run \`pnpm install --frozen-lockfile\`. ` +
      'This is an environment problem, not a failure of the script under test.',
  ).toBe(true);
  sandbox = mkdtempSync(join(tmpdir(), 'pre-flip-scan-test-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * The 5 s default is not enough here and raising it is not papering over anything: every test below
 * SPAWNS `tsx`, which costs ~1.5 s of startup before the script begins, and the sweep runs three of them.
 * Measured: this file passes alone in ~7 s and timed out inside a full `npx vitest run`, where 290 other
 * files are competing for the same cores. A flaky gate test is a gate that gets ignored.
 */
describe('pre-flip-scan — exit 2 means DID NOT RUN, never a pass', { timeout: 60_000 }, () => {
  it("resolves .env relative to CWD — the property this suite's offline safety depends on", () => {
    // THIS TEST RUNS FIRST ON PURPOSE (vitest executes in file order). The suite is only offline because
    // `loadDbEnv` reads the BARE relative paths 'packages/db/.env' and '.env', which Node resolves from
    // cwd. If that were ever changed to resolve from the script's own directory, the "no URL" test below
    // would silently pick up a developer's real DIRECT_URL and fire queries at PRODUCTION. Pinning it
    // here, ahead of that test, is what keeps the window closed.
    const cwd = makeCwd('env-from-cwd', {
      files: { 'contracts/a.json': '{}\n', 'packages/db/.env': `DIRECT_URL=${DEAD_URL}\n` },
    });
    const { code, out } = run(['widgets'], cwd);
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out, 'the sandbox .env was not read — .env resolution is no longer cwd-relative').not.toMatch(
      /no DIRECT_URL or DATABASE_URL/,
    );
    expect(out).toMatch(/DID NOT RUN/);
  });

  it('exits 2 when given no tables at all', () => {
    // The old script exited 1 here, which is the code for "found a blocker" — a caller could not tell a
    // usage error from a real finding.
    const { code, out } = run([], makeCwd('no-args', { files: { 'contracts/a.json': '{}\n' } }));
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).toMatch(/no tables given/);
  });

  it('exits 2 when a pinned data root is missing, instead of searching a smaller population', () => {
    // The vacuous-pass shape for the repo arm: with `contracts/` gone the scan still finds "no hits".
    const cwd = makeCwd('missing-root', {
      roots: ['packages/db/prisma'],
      files: { 'packages/db/prisma/x.sql': '-- x\n' },
    });
    const { code, out } = run(['successors'], cwd, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/pinned data root\(s\) missing/);
    expect(out).toMatch(/contracts/);
  });

  it('exits 2 when the roots exist but contain nothing to search', () => {
    // placeholders:false — this test's whole subject is the repo-WIDE zero, and makeCwd now seeds every
    // root by default (see its comment). With all four roots bare, the repo-wide guard fires first and
    // owns this case; the per-root guard below covers the PARTIAL zero it cannot see.
    const { code, out } = run(['successors'], makeCwd('empty-roots', { placeholders: false }), {
      DIRECT_URL: DEAD_URL,
    });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/ZERO matching files/);
  });

  it('exits 2 when ONE root is present but empty — the partial zero the repo-wide guard cannot see', () => {
    // The regression this guards: scripts/parity converting its .ts files to .mjs (the house pattern for
    // scripts). The directory survives, so `missingRoots` stays empty; the other roots keep filesScanned
    // comfortably non-zero, so the repo-wide guard stays quiet — and the scan silently stops searching
    // the reader class whose entire rationale is that the parity harness reads and WRITES through raw
    // SQL, surviving model deletion mechanically.
    const cwd = makeCwd('one-empty-root', { placeholders: false, files: { 'contracts/a.json': '{}\n' } });
    for (const r of ROOTS) if (r !== 'scripts/parity') writeFileSync(join(cwd, r, '__placeholder.json'), '{}');
    const { code, out } = run(['successors'], cwd, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/present but EMPTY/);
    expect(out).toMatch(/scripts\/parity/);
    expect(out).toMatch(/not a pass/);
  });

  it('exits 2 when no connection URL is resolvable', () => {
    const cwd = makeCwd('no-url', { files: { 'contracts/a.json': '{}\n' } });
    const { code, out } = run(['successors'], cwd);
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/no DIRECT_URL or DATABASE_URL/);
    expect(out).toMatch(/not a pass/);
  });

  it('exits 2 when the Prisma schema parses to zero tables — the database fingerprint is unusable', () => {
    // Without a fingerprint there is no way to tell our database from an empty one, and every arm would
    // then report "clean" against whatever it was pointed at.
    const cwd = makeCwd('zero-prisma', {
      roots: [...ROOTS, 'packages/db/prisma/schema'],
      files: { 'contracts/a.json': '{}\n' },
    });
    const { code, out } = run(['successors'], cwd, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/parsed ZERO tables/);
  });

  it('exits 2 — not 1 — when the database is unreachable, running from the real repo root', () => {
    // The real roots, the real Prisma schema, a dead socket. This is the path a CI job with a rotated
    // secret takes, and conflating it with "found a blocker" is what made #124's acceptance criterion
    // unsatisfiable for check 17 before it was fixed.
    const { code, out } = run(['surveys'], REPO_ROOT, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/DID NOT RUN/);
    expect(out).not.toMatch(/✓/);
  });

  it('exits 2 when --flip-diff cannot read the ledger at the base ref', () => {
    const { code, out } = run(['--flip-diff', '--base', 'no-such-ref-for-tests'], REPO_ROOT, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/could not read docs\/architecture\/table-ownership\.md/);
    // Guessing "no tables flipped" when the diff is unavailable would be a silent pass on a flip PR.
    expect(out).toMatch(/would be a silent pass/);
  });

  it('exits 2 rather than quietly ignoring table names passed alongside --flip-diff', () => {
    const { code, out } = run(['--flip-diff', 'surveys'], REPO_ROOT, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/derives the table list from the ledger/);
  });

  it('no could-not-run path prints a success tick', () => {
    // Independent of exit codes: if a refactor lets a die path fall through to the happy message, this
    // catches it even when the code still happens to be 2.
    const cases: Array<[string, string[], string, Record<string, string>]> = [
      ['no-args', [], makeCwd('sweep-args', { files: { 'contracts/a.json': '{}\n' } }), {}],
      ['no-url', ['successors'], makeCwd('sweep-url', { files: { 'contracts/a.json': '{}\n' } }), {}],
      ['unreachable', ['surveys'], REPO_ROOT, { DIRECT_URL: DEAD_URL }],
    ];
    for (const [name, args, cwd, env] of cases) {
      const { code, out } = run(args, cwd, env);
      expect(code, `${name}: expected exit 2`).toBe(2);
      expect(out, `${name}: must not claim success`).not.toMatch(/✓/);
    }
  });
});

describe('pre-flip-scan — --flip-diff derives the table list from the ledger', { timeout: 60_000 }, () => {
  it('exits 0 without a database when the branch flips nothing, and states what it compared', () => {
    // A gate row has to be runnable on every PR, and most PRs flip nothing. The result must still be a
    // STATEMENT — "12 efcore[] tables there, 12 here, 0 newly efcore-owned" — rather than an empty result
    // dressed up as a pass. With nothing to scan the check must not need a database at all, or it would
    // be permanently ⚠️ NOT RUN for everyone and enforce nothing.
    //
    // DEAD_URL is supplied even though this path must never reach a database, and that is the point: it
    // makes "needs no database" PROVEN rather than assumed. This was the only REPO_ROOT call site that
    // had not pinned a URL — the other four (:242, :249, :257, :268) already did — and run() (:101)
    // builds the child env from scratch, so
    // omitting a URL does not mean "no credentials", it means loadDbEnv() falls through to reading the
    // BARE RELATIVE path `packages/db/.env`, resolved against this cwd. That file holds the production
    // Supabase direct URL. It passes today only because `--base HEAD` on a clean tree exits at the empty
    // -diff branch before loadDbEnv(); one uncommitted efcore[] entry — the exact working-tree state of a
    // developer authoring a flip PR — makes a plain `npx vitest run` open a LIVE PRODUCTION connection.
    // With DEAD_URL set, loadDbEnv() returns at its first line and any regression dies at 127.0.0.1:1.
    //
    // `--base HEAD` rather than the default `origin/main`: CI checks out at fetch-depth 1, where
    // `origin/main` is not a resolvable ref, and a test that only passes on a full clone is a test that
    // goes red for a reason unrelated to its subject. The DEFAULT is pinned as a property below.
    const { code, out } = run(['--flip-diff', '--base', 'HEAD'], REPO_ROOT, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 0, got ${code}. Output:\n${out}`).toBe(0);
    expect(out).toMatch(/no ownership flip in this diff/);
    expect(out).toMatch(/efcore\[\] tables there/);
    expect(out).toMatch(/newly efcore-owned/);
  });

  it('actually finds a flipped table — the positive control the gate row depends on', () => {
    // WITHOUT THIS, THE GATE ROW IS VACUOUS. Check 18 runs `--flip-diff` on every branch and almost
    // always reports "0 newly efcore-owned". If the ledger parse or the set difference broke, it would
    // report exactly the same thing forever, and the one PR class it exists to catch — a flip — would
    // sail through green. So: a throwaway git repo whose HEAD ledger lists one efcore table and whose
    // working tree lists two, and the derived list has to name the difference.
    const cwd = makeCwd('flip-positive', {
      files: {
        'contracts/a.json': '{}\n',
        'docs/architecture/table-ownership.md': ledger(['old_table']),
      },
    });
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'base');
    writeFileSync(join(cwd, 'docs/architecture/table-ownership.md'), ledger(['old_table', 'newly_flipped']));

    const { code, out } = run(['--flip-diff', '--base', 'HEAD'], cwd, { DIRECT_URL: DEAD_URL });
    expect(out).toMatch(/1 newly efcore-owned: newly_flipped/);
    // It then goes on to need a database, and cannot reach one here. Exit 2 — never 0.
    expect(code, `expected exit 2 after deriving the table, got ${code}. Output:\n${out}`).toBe(2);
  });

  it('exits 2 when the ledger at either end lists zero efcore tables', () => {
    // An empty `efcore[]` on either side is a parse that did not work the way the caller assumes. Taking
    // the difference anyway would make every table look newly-flipped, or none — both silently wrong.
    const cwd = makeCwd('flip-empty-ledger', {
      files: { 'contracts/a.json': '{}\n', 'docs/architecture/table-ownership.md': ledger([]) },
    });
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'base');

    const { code, out } = run(['--flip-diff', '--base', 'HEAD'], cwd, { DIRECT_URL: DEAD_URL });
    expect(code, `expected exit 2, got ${code}. Output:\n${out}`).toBe(2);
    expect(out).toMatch(/ZERO efcore\[\] tables/);
  });

  it('defaults the base ref to origin/main', () => {
    // Pinned as a property because the tests above deliberately pass `--base HEAD` for portability.
    expect(SRC).toMatch(/const base = baseIdx >= 0 \? argv\[baseIdx \+ 1\] : 'origin\/main'/);
  });
});

/**
 * Properties of the database arms. These cannot be executed under `npx vitest run`, and every one of
 * them corresponds to a real finding or a real mutation — a source-text pin is weak, but silent rot in
 * any of these turns a clean scan into a lie, which is worse than no scan.
 */
describe('pre-flip-scan — database-arm properties', () => {
  it('every could-not-run path goes through die2, which exits 2', () => {
    expect(SRC).toMatch(/function die2\(reason: string\): never \{[\s\S]{0,400}?process\.exit\(2\)/);
    // writeSync, not console.error: process.exit() does not flush an async stderr pipe, and losing the
    // reason is losing the only thing exit 2 communicates.
    expect(SRC).toMatch(/writeSync\(\s*2,\s*`⚠ PRE-FLIP SCAN DID NOT RUN/);
    // A thrown query is a did-not-run, not a clean result.
    expect(SRC).toMatch(/main\(\)\.catch\(\(err\) => \{[\s\S]{0,600}?die2\(/);
  });

  it('exits 1 only when the blocker list is non-empty, and 0 only when it is empty', () => {
    expect(SRC).toMatch(/if \(blockers\.length === 0\)[\s\S]{0,1400}?process\.exit\(0\)/);
    expect(SRC).toMatch(/BLOCKER\(s\)[\s\S]{0,900}?process\.exit\(1\)/);
  });

  it('fingerprints the database against the Prisma schema, so an empty one cannot pass', () => {
    // Proved for real: against an empty database this prints "only 0 of the 96 tables declared by the
    // Prisma schema exist in this database" and exits 2.
    expect(SRC).toMatch(/if \(present \* 2 < prismaTables\.length\)/);
    expect(SRC).toMatch(
      /empty database, a\s*\n?\s*\* ?restored copy or the wrong target|restored copy or the wrong target/,
    );
  });

  it('refuses to believe an arm whose matcher could not be proved', () => {
    expect(SRC).toMatch(/const unproven = arms\.filter\(\(a\) => a\.population > 0 && !a\.proven\)/);
    expect(SRC).toMatch(/if \(unproven\.length > 0\)[\s\S]{0,400}?die2\(/);
    // The proof re-runs the ARM'S OWN query against a row it must match. A proof that ran a different
    // query would demonstrate nothing about the arm.
    expect(SRC).toMatch(/const found = await run\(wordRe\(tokens\[0\]\)\)/);
    expect(SRC).toMatch(/if \(found\.includes\(sample\.name\)\)/);
  });

  it('reports an empty population as NOT EXERCISED instead of as a clean result', () => {
    expect(SRC).toMatch(/population is empty — arm NOT EXERCISED/);
    expect(SRC).toMatch(/searched an EMPTY population and therefore proved nothing/);
  });

  it('uses the Postgres word boundary `\\y`, which `\\b` cannot replace', () => {
    // Measured on PG 17.10: `\b` is a BACKSPACE in a Postgres advanced RE, so a `\b` matcher returns
    // false for every input — every arm would report clean forever.
    expect(SRC).toMatch(/const wordRe = \(t: string\): string => `\\\\y\$\{t/);
  });

  it('searches SQL-standard function bodies, which live in prosqlbody with prosrc = emptystring', () => {
    // Measured on PG 17.10: `LANGUAGE sql BEGIN ATOMIC ... END` (and the `RETURN` form) store the body
    // PARSED in pg_proc.prosqlbody and leave prosrc = ''. A `prosrc`-only matcher cannot see such a
    // function, and because 'pg_proc' is in NAMED, the pg_depend edge that DOES exist is printed as INFO
    // rather than pushed onto blockers — so the scan named the reader and still exited 0.
    //
    // Pinned as three separate properties because each one alone can be defeated: the MATCHER must
    // search the concatenation, the POPULATION must count what the matcher can search (otherwise the arm
    // reports 0 and proveArm reads it as NOT EXERCISED — a second path to a green exit), and
    // pg_get_functiondef must never be substituted, as it THROWS on aggregates and would convert this
    // arm into a permanent exit 2.
    // Pin the USE, not just the definition. An earlier version of this test asserted only that the
    // `routineBody` const EXISTS — which `routineSamples` keeps alive, so reverting the matcher alone to
    // `AND p.prosrc ~* $1` reintroduced B2 with every pin in this file still green. Assert against CODE
    // (comment-stripped, :87) so a citation of the old spelling in a comment cannot satisfy or break it.
    expect(CODE).toMatch(
      /const routineBody = .*coalesce\(p\.prosrc,''\) \|\| coalesce\(pg_get_function_sqlbody\(p\.oid\)::text,''\)/,
    );
    expect(CODE).toMatch(/AND \$\{routineBody\} ~\* \$1/);
    // The matcher must not fall back to prosrc alone anywhere.
    expect(CODE).not.toMatch(/p\.prosrc ~\*/);
    // The population must count what the matcher can search, or an all-SQL-standard-body database
    // reports 0 and proveArm reads it as NOT EXERCISED — a second, independent path to a green exit.
    expect(CODE).toMatch(/p\.prosrc IS NOT NULL AND p\.prosrc <> '' OR p\.prosqlbody IS NOT NULL/);
    // …and the samples must be drawn from the same concatenation the matcher searches.
    expect(CODE).toMatch(/length\(\$\{routineBody\}\) > 3/);
    expect(CODE).not.toMatch(/pg_get_functiondef/);
  });

  it('matches the table name exactly, so a mixed-case table is not a false "does not exist"', () => {
    // `to_regclass('public.'||$1)` folds an unquoted name to lower case and reported
    // `__EFMigrationsHistory` as non-existent — a false BLOCKER. Verified against the throwaway cluster.
    expect(SRC).toMatch(/WHERE n\.nspname = 'public' AND c\.relname = \$1/);
    expect(CODE).not.toMatch(/to_regclass\('public\.'\|\|\$1\)/);
    expect(CODE).not.toMatch(/lower\(c\.relname\)/);
  });

  it('resolves inbound FKs by OID, so a same-named constraint elsewhere cannot become a phantom', () => {
    // SUPERSEDED AND STRENGTHENED, not deleted. The previous version of this assertion pinned
    // `kcu.constraint_schema = tc.constraint_schema`, a patch over `information_schema`'s non-unique
    // `constraint_name`. `pg_constraint.confrelid` is an OID, so the ambiguity cannot arise at all —
    // pin the stronger property rather than keep defending the older fix.
    expect(SRC).toMatch(/con\.contype = 'f' AND con\.confrelid = \$1/);
    expect(CODE).not.toMatch(/information_schema\.table_constraints/);
  });

  it('scans pg_depend generally, not just pg_rewrite, and only the explicit dependency edge', () => {
    expect(SRC).toMatch(
      /FROM pg_depend d\s*\n?\s*WHERE d\.refclassid = 'pg_class'::regclass AND d\.refobjid = \$1 AND d\.deptype = 'n'/,
    );
    // The classes it can name are named; whatever is left over is the bucket that needs a human.
    expect(SRC).toMatch(
      /const NAMED = new Set\(\['pg_rewrite', 'pg_proc', 'pg_trigger', 'pg_constraint', 'pg_policy'\]\)/,
    );
    expect(SRC).toMatch(/for \(const d of r\.otherDependents\) blockers\.push/);
  });

  it('gives routines a SECOND blocking oracle, so an empty prosrc is no longer the only defence', () => {
    // B2's residue. `pg_proc` is in NAMED, so its pg_depend edge used to route to `namedDependents` —
    // printed under "pg_depend (named classes)" and never pushed onto `blockers`. The text arm was the
    // ONLY blocking path for a routine, so a SQL-standard-bodied function (empty prosrc) was NAMED by
    // the scan and then exited 0. Matched against CODE, not SRC: "pg_depend" appears in comments.
    expect(CODE).toMatch(/const routinesByDepend = deps\.rows/);
    expect(CODE).toMatch(/\.filter\(\(d\) => d\.cls === 'pg_proc'\)/);
    expect(CODE).toMatch(/for \(const f of r\.dependentRoutinesByDepend\) \{/);
    expect(CODE).toMatch(/blockers\.push\(`\$\{r\.table\}: function \$\{f\} references it \(pg_depend\)`\)/);
  });

  it('writes stdout SYNCHRONOUSLY, so a piped run cannot truncate the report', () => {
    // Node's stdout is async when it is a pipe and process.exit() discards pending writes — the same
    // property die2 already defends against on fd 2. Every stdout path here is immediately followed by
    // an exit, so console.log truncates at the ~64KB pipe buffer (reproduced on darwin/node v25:
    // 400KB console.log piped -> 65536 bytes; redirected to a file -> 400014). Matched against CODE so
    // the explanatory comments that NAME console.log do not satisfy the pin.
    expect(CODE).not.toMatch(/console\.log\(/);
    expect(CODE).toMatch(/function out\(line = ''\): void \{/);
    expect(CODE).toMatch(/writeSync\(1, `\$\{line\}\\n`\)/);
  });

  it('does NOT feed routines to oracleSplits — they are disjoint by construction, so it would cry wolf', () => {
    // Deliberate asymmetry with views, and the reason is measured: a plpgsql or dollar-quoted
    // `LANGUAGE sql` body records no pg_depend edge at all, while a SQL-standard body records one. The
    // two routine oracles therefore DISAGREE for almost every function that exists, so a split line
    // would fire forever in both directions — and a check that cries wolf gets switched off.
    const splitBlock = blockAt(CODE, 'const oracleSplits');
    expect(splitBlock).not.toMatch(/dependentRoutines/);
  });

  it('blocks on views found by EITHER oracle, and reports where they disagree', () => {
    expect(SRC).toMatch(/new Set\(\[\.\.\.r\.dependentViews, \.\.\.r\.dependentViewsByDepend\]\)/);
    expect(SRC).toMatch(/pg_depend only/);
    expect(SRC).toMatch(/text matcher only/);
  });

  it('classifies functions, triggers and missing tables as blockers', () => {
    expect(SRC).toMatch(/if \(!r\.exists\) blockers\.push/);
    expect(SRC).toMatch(/for \(const f of r\.dependentRoutines\) blockers\.push/);
    expect(SRC).toMatch(/for \(const t of r\.triggers\) blockers\.push/);
  });

  it('blocks when the name resolves to something other than an ordinary table', () => {
    // The existence probe deliberately carries no relkind filter, so that a name resolving to a
    // view/matview/sequence is distinguishable from one that is absent. That only helps if the KIND is
    // then asserted: otherwise `exists` is true, the !exists blocker does not fire, and every OID-keyed
    // arm scans an object that is itself a reader. Matched against CODE — "ordinary table" also occurs
    // in prose comments, so an SRC match here would pass on the comment alone.
    expect(CODE).toMatch(/r\.relkind !== 'r' && r\.relkind !== 'p'/);
    expect(CODE).toMatch(/blockers\.push\([\s\S]{0,120}not an ordinary table/);
    // And the query must STAY broad — narrowing it makes the branch above unreachable and collapses the
    // case into the "does not exist" message it exists to distinguish.
    expect(CODE).toMatch(/WHERE n\.nspname = 'public' AND c\.relname = \$1/);
  });

  it('excludes the scanned table itself from the "policies elsewhere referencing it" query', () => {
    expect(SRC).toMatch(/AND c\.relname <> \$2/);
    // …and disables that exclusion for the self-test, or the sample could never be re-found.
    expect(SRC).toMatch(/SENTINEL_TABLE/);
  });

  it('does not let a failed db.end() mask the original connection error', () => {
    expect(SRC).toMatch(/db\.end\(\)\.catch\(\(\) => undefined\)/);
  });
});

describe('pre-flip-scan — --json is a machine interface', () => {
  it('emits nothing but JSON on stdout, including on the clean and the no-flip paths', () => {
    expect(SRC).toMatch(/if \(!asJson\) \{[\s\S]{0,700}?No blocker for/);
    expect(SRC).toMatch(/asJson \? JSON\.stringify\(\{ flipDiff: true/);
  });

  it('sends blocker output to stderr so it cannot corrupt the JSON payload', () => {
    expect(SRC).toMatch(/writeSync\(2, `\\n✖ \$\{blockers\.length\} BLOCKER\(s\)/);
  });
});
