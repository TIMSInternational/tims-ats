#!/usr/bin/env npx tsx
/**
 * Pre-flip dependency scan — issue #132, the ownership-flip runbook's §5 step 5b control.
 *
 * WHY THIS EXISTS
 * ---------------
 * The runbook's P2 reader sweep is six `grep` strategies over the repo. They share two blind spots:
 *
 *   1. DATA-DRIVEN readers. All six are `.ts`-scoped, and `tsc` cannot see a model name inside a JSON
 *      file. Flip #2 removed two entities from `ScopedEntity`, got a GREEN `tsc`, and broke
 *      `contracts/access-fixtures/scope-where.json` — a CROSS-STACK contract that also pins the C#
 *      port. Handled by `./pre-flip-repo-scan.mjs`, which is unit-tested for real.
 *   2. DATABASE-SIDE readers. A view, matview, function, trigger or policy over the table is a raw-SQL
 *      reader that is invisible to `tsc`, to `scripts/table-ownership.mjs` (it only greps `@@map` /
 *      `ToTable`), and to every P2 grep — because the object is not in the repo at all. #111 is the
 *      standing proof that production contains objects no repo file describes.
 *
 * WHY EVERY ARM CARRIES A NON-VACUITY CONTROL
 * -------------------------------------------
 * On 2026-08-05 the equivalent queries were run against production by hand and returned EMPTY for the
 * calibration tables. An empty result is indistinguishable from a query that examined nothing, and one
 * of the arms had in fact examined nothing worth the name: the view/matview arm returned 0 across the
 * whole `public` schema, which proves nothing on its own, because `public` contains 119 ordinary tables
 * and ZERO views, matviews or foreign tables. It took a separate census to learn that its 0 was
 * correct-but-untested. Checks 14, 16 and 17 each shipped with exactly this defect and each had to be
 * fixed afterwards.
 *
 * So every arm here reports the POPULATION it searched, and every text-matching arm proves its matcher
 * end-to-end before its result is believed:
 *
 *   population unknown / query threw → exit 2. Never a pass.
 *   population > 0, matcher unproven → exit 2. A matcher that finds nothing when pointed at a row it
 *                                      MUST match makes every clean result from that arm worthless.
 *   population = 0                   → reported as NOT EXERCISED, loudly, in the summary and the JSON.
 *
 * And the run as a whole is fingerprinted against the Prisma schema, so an empty or wrong database
 * cannot produce a tick: against an EMPTY database this exits 2, not 0.
 *
 * TWO INDEPENDENT VIEW ORACLES, AND WHY NEITHER IS ENOUGH ALONE
 * -------------------------------------------------------------
 * Views are found BOTH by matching the table name in `pg_get_viewdef` AND through `pg_depend`. The two
 * are not redundant, and neither subsumes the other — measured on a throwaway PostgreSQL 17.10 cluster:
 *
 *   - `pg_depend` is authoritative for views and matviews but records NOTHING for a `plpgsql` function
 *     body. A `plpgsql` function whose body reads the table produced exactly 0 `pg_proc` rows in
 *     `pg_depend`, so the FUNCTION arm can only ever be a text match.
 *   - The text arm cannot see a dependency that renders no table name, and `pg_get_viewdef` is not the
 *     only way a relation can depend on a table.
 *
 * So both run, both are printed separately, blockers are their union, and a disagreement is reported.
 * `pg_depend` is filtered to `deptype = 'n'` — the explicit "this object needs that one" edge. The
 * table's OWN internals (its indexes, constraints, defaults, extended statistics, triggers) come back as
 * `'a'`/`'i'` and would be pure noise; that classification was checked against the catalog, not assumed.
 *
 * WHAT IT CHECKS, per table
 *   BLOCKER  views / matviews referencing the table, by text AND by `pg_depend`
 *   BLOCKER  functions whose body references the table
 *   BLOCKER  triggers on the table
 *   BLOCKER  any other `pg_depend` dependent — the classes above are named and reported as such, so
 *            this bucket is whatever this script does not model, which is exactly the case for a human
 *   BLOCKER  data-file readers under `contracts/access-fixtures/` and `packages/db/prisma/seed*.ts`
 *   INFO     RLS policies on OTHER tables referencing it (runbook §3(f) pre-REVOKE scan)
 *   INFO     inbound foreign keys (one from outside the flip set means the flip is not self-contained)
 *   INFO     `app_tenant` grants (#126 — dead DML after the flip)
 *   INFO     every other data-file reference, for the PR body
 *   INFO     existence, relkind, RLS enabled/forced, policy count, size
 *
 * BLOCKER vs INFO: a database object or a fixture over the table must be dispositioned BEFORE the model
 * is deleted, because deleting the model does not break it — it keeps working, and keeps bypassing
 * whatever scoping the TS stack used to apply.
 *
 * USAGE
 *   npx tsx scripts/db/pre-flip-scan.ts critical_roles successors
 *   npx tsx scripts/db/pre-flip-scan.ts --json surveys survey_responses
 *   npx tsx scripts/db/pre-flip-scan.ts --flip-diff            # tables this branch moves into efcore[]
 *   npx tsx scripts/db/pre-flip-scan.ts --flip-diff --base origin/main
 *
 * EXIT CODES — the contract shared with `/gate` checks 14, 16 and 17
 *   0  ran, and found no blocker
 *   1  ran, and found a blocker
 *   2  COULD NOT RUN — no connection URL; a pinned data root missing; the Prisma schema parsed to zero
 *      tables; the target database does not look like ours; an arm's population unknown or its matcher
 *      unproven; or any query threw. Exit 2 is NOT a pass and must be reported ⚠️ NOT RUN.
 *
 * Read-only: every statement is a SELECT, safe against production.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import { Client } from 'pg';
import { parseLedger, parsePrismaTables } from '../table-ownership.mjs';
import { DATA_ROOTS, scanDataFiles } from './pre-flip-repo-scan.mjs';

const LEDGER_REL = 'docs/architecture/table-ownership.md';
const PRISMA_SCHEMA_REL = 'packages/db/prisma/schema';

/**
 * Exit 2 — could not run. Written with `writeSync(2, …)` rather than `console.error` because Node's
 * stderr is ASYNC when it is a pipe and `process.exit()` does not flush pending writes: the one thing
 * exit 2 exists to communicate is WHY nothing was verified, and every automated caller pipes stderr.
 * Copied deliberately from `verify-tenant-grants.ts`, which learned it the same way.
 */
function die2(reason: string): never {
  writeSync(2, `⚠ PRE-FLIP SCAN DID NOT RUN — ${reason}\n  This is exit 2, not a pass. Nothing was scanned.\n`);
  process.exit(2);
}

function loadDbEnv(): void {
  if (process.env.DIRECT_URL || process.env.DATABASE_URL) return;
  for (const path of ['packages/db/.env', '.env']) {
    try {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = /^\s*(DIRECT_URL|DATABASE_URL)\s*=\s*(.*)$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      /* file absent — try the next one */
    }
    if (process.env.DIRECT_URL || process.env.DATABASE_URL) return;
  }
}

/**
 * `\y` is Postgres's word boundary. Do NOT "modernise" it to `\b`: in a Postgres advanced regular
 * expression `\b` is a BACKSPACE, not a boundary. Measured on PG 17.10 — both
 * `'critical_roles_pkey' ~* '\bcritical_roles\b'` and `'x critical_roles y' ~* '\bcritical_roles\b'`
 * return false, so a `\b` matcher finds NOTHING and every scan comes back clean. That is the exact shape
 * of failure this whole rewrite exists to make impossible, and it is why the arms carry matcher proofs.
 */
const wordRe = (t: string): string => `\\y${t.replace(/([\\^$.|?*+()[\]{}])/g, '\\$1')}\\y`;

/** An identifier that must not exist, used to disable the "exclude the table itself" clause in a self-test. */
const SENTINEL_TABLE = '__preflip_sentinel_no_such_table__';

interface Arm {
  key: string;
  label: string;
  /** How many candidate objects the arm's own predicate could have matched. */
  population: number;
  /** What the population counts, in words — printed so "0 hits" is never read as "0 out of 0". */
  populationLabel: string;
  /** Whether the arm's matcher was demonstrated against a row it MUST match. */
  proven: boolean;
  /** Why it is unproven, when it is. */
  note: string;
}

interface TableReport {
  table: string;
  exists: boolean;
  relkind: string | null;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: string[];
  bytes: number | null;
  /** Views found by matching the table name in `pg_get_viewdef`. */
  dependentViews: string[];
  /** Views found through `pg_depend` — text-free, authoritative, and an independent oracle. */
  dependentViewsByDepend: string[];
  dependentRoutines: string[];
  triggers: string[];
  otherDependents: string[];
  namedDependents: string[];
  policiesReferencing: string[];
  inboundFks: string[];
  appTenantPrivs: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Table selection
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `--flip-diff`: the tables this working tree moves INTO the ledger's `efcore[]` relative to `base`.
 *
 * This is what makes the scan wireable as a `/gate` row: a gate cannot hard-code table names, and a
 * per-flip control nobody remembers to run is the state #132 was filed about. On a branch that flips
 * nothing it scans nothing and says so — while still reporting the population it compared, so "no
 * tables" is a stated finding rather than an empty result.
 */
function tablesFromLedgerDiff(base: string): { tables: string[]; headCount: number; baseCount: number } {
  let headLedger: { efcore: string[] };
  try {
    headLedger = parseLedger(readFileSync(LEDGER_REL, 'utf8')) as { efcore: string[] };
  } catch (e) {
    die2(`could not parse ${LEDGER_REL} in the working tree (${e instanceof Error ? e.message : e}).`);
  }

  let baseText: string;
  try {
    baseText = execFileSync('git', ['show', `${base}:${LEDGER_REL}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    die2(
      `could not read ${LEDGER_REL} at \`${base}\` (${e instanceof Error ? e.message : e}). ` +
        'Run `git fetch origin`, or pass --base <ref>. Without both sides of the diff there is no way to ' +
        'know which tables this branch flips, and guessing "none" would be a silent pass.',
    );
  }
  let baseLedger: { efcore: string[] };
  try {
    baseLedger = parseLedger(baseText) as { efcore: string[] };
  } catch (e) {
    die2(`could not parse ${LEDGER_REL} at \`${base}\` (${e instanceof Error ? e.message : e}).`);
  }

  // Non-vacuity: an empty efcore[] on either side means the ledger did not parse the way we think it
  // did, and every table would then look either newly-flipped or not-flipped for the wrong reason.
  if (headLedger.efcore.length === 0) die2(`${LEDGER_REL} in the working tree lists ZERO efcore[] tables.`);
  if (baseLedger.efcore.length === 0) die2(`${LEDGER_REL} at \`${base}\` lists ZERO efcore[] tables.`);

  const before = new Set(baseLedger.efcore);
  return {
    tables: headLedger.efcore.filter((t) => !before.has(t)).sort(),
    headCount: headLedger.efcore.length,
    baseCount: baseLedger.efcore.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const flipDiff = argv.includes('--flip-diff');
  const baseIdx = argv.indexOf('--base');
  const base = baseIdx >= 0 ? argv[baseIdx + 1] : 'origin/main';
  if (baseIdx >= 0 && !base) die2('--base was given without a ref.');
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(baseIdx >= 0 && i === baseIdx + 1));

  let tables = positional;
  let diffNote = '';
  if (flipDiff) {
    if (positional.length > 0) {
      die2('--flip-diff derives the table list from the ledger; do not also pass table names.');
    }
    const d = tablesFromLedgerDiff(base);
    tables = d.tables;
    diffNote =
      `ledger diff vs \`${base}\`: ${d.baseCount} efcore[] tables there, ${d.headCount} here, ` +
      `${d.tables.length} newly efcore-owned`;
    if (tables.length === 0) {
      // A real, stated finding — with its population — not an empty result dressed up as a pass.
      const line = `✓ pre-flip scan: no ownership flip in this diff (${diffNote}). Nothing to scan.`;
      console.log(asJson ? JSON.stringify({ flipDiff: true, tables: [], note: diffNote }, null, 2) : line);
      process.exit(0);
    }
    // Say what was derived BEFORE anything can fail. If this only printed in the final report, then a
    // credentials problem — the most likely failure — would leave nobody able to tell "the diff found
    // nothing" from "the diff found something and we never got to it". They are opposite situations.
    if (!asJson) console.log(`\n${diffNote}: ${tables.join(', ')}`);
  } else if (tables.length === 0) {
    die2(
      'no tables given. usage: npx tsx scripts/db/pre-flip-scan.ts [--json] [--flip-diff [--base <ref>]] <table>...',
    );
  }

  // ── Arm 0: the repo's data files. Runs first because it needs no database, so a credentials problem
  //    cannot hide a fixture break that is visible from the working tree alone.
  const repo = scanDataFiles(tables, process.cwd());
  if (repo.missingRoots.length > 0) {
    die2(
      `pinned data root(s) missing from the working tree: ${repo.missingRoots.join(', ')}. ` +
        'The data-driven arm would have searched a smaller population and still reported "no hits" — ' +
        'which is the vacuous pass this scan exists to make impossible. Run from the repo root, or fix ' +
        'DATA_ROOTS in scripts/db/pre-flip-repo-scan.mjs if a directory really was renamed.',
    );
  }
  if (repo.filesScanned === 0) {
    die2(`the ${DATA_ROOTS.length} pinned data roots exist but contain ZERO matching files — nothing was searched.`);
  }

  loadDbEnv();
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    die2('no DIRECT_URL or DATABASE_URL in the environment or packages/db/.env.');
  }

  // The Prisma schema is this database's fingerprint: it is how we tell "our application's database"
  // from an empty one, a restored copy, or a sibling in the same cluster. Same guard, and the same
  // reason, as verify-tenant-grants.ts (#124).
  let prismaTables: string[];
  try {
    prismaTables = [...parsePrismaTables(PRISMA_SCHEMA_REL)];
  } catch (e) {
    die2(`could not read ${PRISMA_SCHEMA_REL} (${e instanceof Error ? e.message : e}) — run from the repo root.`);
  }
  if (prismaTables.length === 0)
    die2(`parsed ZERO tables from ${PRISMA_SCHEMA_REL} — refusing to fingerprint against nothing.`);

  const db = new Client({ connectionString: url });
  const arms: Arm[] = [];
  const reports: TableReport[] = [];
  let census = { tables: 0, views: 0, matviews: 0, foreignTables: 0 };

  try {
    await db.connect();

    // ── Census + wrong-database guard ────────────────────────────────────────────────────────────
    const censusRow = await db.query<{ tables: string; views: string; matviews: string; foreign_tables: string }>(
      `SELECT count(*) FILTER (WHERE c.relkind IN ('r','p'))::text AS tables,
              count(*) FILTER (WHERE c.relkind = 'v')::text        AS views,
              count(*) FILTER (WHERE c.relkind = 'm')::text        AS matviews,
              count(*) FILTER (WHERE c.relkind = 'f')::text        AS foreign_tables
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'`,
    );
    census = {
      tables: Number(censusRow.rows[0]?.tables ?? 0),
      views: Number(censusRow.rows[0]?.views ?? 0),
      matviews: Number(censusRow.rows[0]?.matviews ?? 0),
      foreignTables: Number(censusRow.rows[0]?.foreign_tables ?? 0),
    };

    const presentRow = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname = ANY($1::text[])`,
      [prismaTables],
    );
    const present = Number(presentRow.rows[0]?.n ?? 0);
    if (present * 2 < prismaTables.length) {
      die2(
        `only ${present} of the ${prismaTables.length} tables declared by the Prisma schema exist in this ` +
          `database (public holds ${census.tables} ordinary tables in total). This is an empty database, a ` +
          'restored copy or the wrong target — a clean scan against it would certify nothing. Check which ' +
          'database DIRECT_URL/DATABASE_URL points at.',
      );
    }

    // ── Arm populations + matcher proofs, once per database ──────────────────────────────────────
    // Every text-matching arm is proved by taking a row it MUST match, extracting a word from the very
    // text the arm searches, and re-running the ARM'S OWN query with that word. That catches a wrong
    // schema filter, a wrong column, a regex the server rejects, and permission-filtered rows — none of
    // which a source-code review of the SQL reliably catches, and all of which look like "clean".
    const scopedSchemas = `n.nspname NOT IN ('pg_catalog','information_schema')`;

    const viewsQuery = async (re: string): Promise<string[]> => {
      const r = await db.query<{ name: string }>(
        `SELECT n.nspname||'.'||c.relname AS name
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('v','m') AND ${scopedSchemas} AND pg_get_viewdef(c.oid) ~* $1
          ORDER BY 1`,
        [re],
      );
      return r.rows.map((x) => x.name);
    };
    const viewPop = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('v','m') AND ${scopedSchemas}`,
    );
    const viewSamples = await db.query<{ name: string; text: string }>(
      `SELECT n.nspname||'.'||c.relname AS name, pg_get_viewdef(c.oid) AS text
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('v','m') AND ${scopedSchemas}
        ORDER BY c.oid LIMIT 5`,
    );
    arms.push(
      await proveArm(
        'views',
        'views/matviews referencing it',
        Number(viewPop.rows[0].n),
        'views + matviews outside pg_catalog/information_schema',
        viewSamples.rows,
        viewsQuery,
      ),
    );

    // A function's body is NOT always in `prosrc`. Since PG14 a SQL-standard body — `LANGUAGE sql
    // BEGIN ATOMIC ... END`, and equally the `RETURN <expr>` form — is stored PARSED in
    // `pg_proc.prosqlbody`, leaving `prosrc = ''` (empty string, not null). Matching `prosrc` alone
    // therefore cannot see such a function at all, and this is the ONLY blocking path for a routine:
    // the general pg_depend query does find the edge, but `pg_proc` is in NAMED, so it is routed to
    // `namedDependents` — printed as INFO and never pushed onto `blockers`. Net effect before this fix:
    // a SQL-standard-body function reading the flipped table is discovered, printed, and the scan still
    // exits 0. That is a false negative in a fail-closed control.
    //
    // `pg_get_function_sqlbody(oid)` returns NULL (not an error) for every non-SQL-body function,
    // including aggregates and window functions, so the concatenation is always safe. Do NOT reach for
    // `pg_get_functiondef(oid)` instead — it THROWS on aggregates, which would turn this arm into a
    // permanent exit 2.
    const routineBody = `(coalesce(p.prosrc,'') || coalesce(pg_get_function_sqlbody(p.oid)::text,''))`;
    const routinesQuery = async (re: string): Promise<string[]> => {
      const r = await db.query<{ name: string }>(
        `SELECT n.nspname||'.'||p.proname AS name
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE ${scopedSchemas} AND ${routineBody} ~* $1
          ORDER BY 1`,
        [re],
      );
      return r.rows.map((x) => x.name);
    };
    // The population must count what the matcher can actually search, or a database whose relevant
    // routines are all SQL-standard-bodied reports population 0 — which proveArm reads as "arm not
    // exercised", so the unproven gate cannot fire and the scan exits 0 on a second, independent path.
    const routinePop = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE ${scopedSchemas} AND (p.prosrc IS NOT NULL AND p.prosrc <> '' OR p.prosqlbody IS NOT NULL)`,
    );
    const routineSamples = await db.query<{ name: string; text: string }>(
      `SELECT n.nspname||'.'||p.proname AS name, ${routineBody} AS text
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE ${scopedSchemas} AND length(${routineBody}) > 3
        ORDER BY p.oid LIMIT 8`,
    );
    arms.push(
      await proveArm(
        'functions',
        'functions referencing it',
        Number(routinePop.rows[0].n),
        'functions with a body outside pg_catalog/information_schema',
        routineSamples.rows,
        routinesQuery,
      ),
    );

    // §3(f): a policy on ANOTHER table whose USING/WITH CHECK references this one. Such a policy is
    // evaluated AS THE QUERYING ROLE, so it depends on the table staying readable by that role — it must
    // be dispositioned before revoking anything (#126) and before the flip.
    const policiesQuery = async (re: string, exclude = SENTINEL_TABLE): Promise<string[]> => {
      const r = await db.query<{ name: string }>(
        `SELECT n.nspname||'.'||c.relname||'.'||p.polname AS name
           FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE ${scopedSchemas}
            AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~* $1
              OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* $1)
            AND c.relname <> $2
          ORDER BY 1`,
        [re, exclude],
      );
      return r.rows.map((x) => x.name);
    };
    const policyPop = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE ${scopedSchemas} AND (p.polqual IS NOT NULL OR p.polwithcheck IS NOT NULL)`,
    );
    const policySamples = await db.query<{ name: string; text: string }>(
      `SELECT n.nspname||'.'||c.relname||'.'||p.polname AS name,
              coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
              coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS text
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE ${scopedSchemas} AND (p.polqual IS NOT NULL OR p.polwithcheck IS NOT NULL)
        ORDER BY p.oid LIMIT 5`,
    );
    arms.push(
      await proveArm(
        'policies',
        'policies elsewhere referencing it',
        Number(policyPop.rows[0].n),
        'policies carrying a USING or WITH CHECK expression',
        policySamples.rows,
        (re) => policiesQuery(re),
      ),
    );

    // The FK, trigger and pg_depend arms resolve the table by OID, so they match no text and need no
    // matcher proof — but they still report their population, because "0 inbound FKs" in a database
    // with no foreign keys at all is not the same statement as "0 inbound FKs" in ours.
    const fkPop = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'`,
    );
    arms.push({
      key: 'fks',
      label: 'inbound foreign keys',
      population: Number(fkPop.rows[0].n),
      populationLabel: 'foreign-key constraints in public',
      proven: true,
      note: 'resolved by OID — no text matching',
    });

    const trigPop = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname = 'public'`,
    );
    arms.push({
      key: 'triggers',
      label: 'triggers on it',
      population: Number(trigPop.rows[0].n),
      populationLabel: 'user triggers in public',
      proven: true,
      note: 'resolved by OID — no text matching',
    });

    const dependPop = await db.query<{ n: string }>(
      `SELECT count(DISTINCT d.refobjid)::text AS n FROM pg_depend d
         JOIN pg_class c ON c.oid = d.refobjid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE d.refclassid = 'pg_class'::regclass AND d.deptype = 'n' AND n.nspname = 'public'`,
    );
    arms.push({
      key: 'depend',
      label: 'pg_depend dependents',
      population: Number(dependPop.rows[0].n),
      populationLabel: 'public relations carrying at least one normal dependency',
      proven: true,
      note: 'resolved by OID — no text matching',
    });

    const grantPop = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee = 'app_tenant'`,
    );
    arms.push({
      key: 'grants',
      label: 'app_tenant grants',
      population: Number(grantPop.rows[0].n),
      populationLabel: 'app_tenant grants in public',
      proven: true,
      note: 'exact grantee match — no text matching',
    });

    // ── Per-table scan ──────────────────────────────────────────────────────────────────────────
    for (const table of tables) {
      const re = wordRe(table);

      const meta = await db.query<{
        oid: string;
        relkind: string;
        rls_enabled: boolean;
        rls_forced: boolean;
        bytes: string | null;
      }>(
        // Matched on `relname` exactly rather than through `to_regclass('public.'||$1)`, which folds an
        // unquoted name to lower case and so reported `__EFMigrationsHistory` as non-existent.
        `SELECT c.oid::text AS oid, c.relkind::text AS relkind,
                coalesce(c.relrowsecurity,false)      AS rls_enabled,
                coalesce(c.relforcerowsecurity,false) AS rls_forced,
                pg_relation_size(c.oid)::text         AS bytes
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1`,
        [table],
      );
      const row = meta.rows[0];
      const oid = row ? Number(row.oid) : null;

      const own = row
        ? await db.query<{ polname: string }>(`SELECT p.polname FROM pg_policy p WHERE p.polrelid = $1 ORDER BY 1`, [
            oid,
          ])
        : { rows: [] as { polname: string }[] };

      const fks = row
        ? await db.query<{ name: string }>(
            // pg_constraint is OID-based, so the phantom-FK class that `information_schema` produces
            // (constraint_name is NOT unique across schemas) cannot arise here at all.
            `SELECT src.relname||'.'||att.attname||' ('||con.conname||')' AS name
               FROM pg_constraint con
               JOIN pg_class src ON src.oid = con.conrelid
               JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
               JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
              WHERE con.contype = 'f' AND con.confrelid = $1
              ORDER BY 1`,
            [oid],
          )
        : { rows: [] as { name: string }[] };

      const trigs = row
        ? await db.query<{ name: string }>(
            `SELECT t.tgname||' → '||p.proname AS name FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE t.tgrelid = $1 AND NOT t.tgisinternal ORDER BY 1`,
            [oid],
          )
        : { rows: [] as { name: string }[] };

      // pg_depend, GENERALLY — not just pg_rewrite. A column default, a generated column, an expression
      // index or an extension member can depend on a table without any view or function existing.
      // deptype 'n' is the explicit "this object needs that one" edge; 'a'/'i' are the table's own
      // internals (its indexes, its constraints, its own policies) and would be pure noise.
      const deps = row
        ? await db.query<{ cls: string; what: string }>(
            `SELECT DISTINCT d.classid::regclass::text AS cls,
                    CASE d.classid
                      WHEN 'pg_rewrite'::regclass    THEN 'view/rule '   || coalesce((SELECT vn.nspname||'.'||vc.relname FROM pg_rewrite r JOIN pg_class vc ON vc.oid = r.ev_class JOIN pg_namespace vn ON vn.oid = vc.relnamespace WHERE r.oid = d.objid), '?')
                      WHEN 'pg_proc'::regclass       THEN 'function '    || coalesce(d.objid::regprocedure::text, '?')
                      WHEN 'pg_trigger'::regclass    THEN 'trigger '     || coalesce((SELECT t.tgname||' on '||tc.relname FROM pg_trigger t JOIN pg_class tc ON tc.oid = t.tgrelid WHERE t.oid = d.objid), '?')
                      WHEN 'pg_constraint'::regclass THEN 'constraint '  || coalesce((SELECT cn.conname||' on '||coalesce(cc.relname,'-') FROM pg_constraint cn LEFT JOIN pg_class cc ON cc.oid = cn.conrelid WHERE cn.oid = d.objid), '?')
                      WHEN 'pg_policy'::regclass     THEN 'policy '      || coalesce((SELECT pc.relname||'.'||pp.polname FROM pg_policy pp JOIN pg_class pc ON pc.oid = pp.polrelid WHERE pp.oid = d.objid), '?')
                      WHEN 'pg_attrdef'::regclass    THEN 'column default ' || coalesce((SELECT ac.relname||'.'||aa.attname FROM pg_attrdef ad JOIN pg_class ac ON ac.oid = ad.adrelid JOIN pg_attribute aa ON aa.attrelid = ad.adrelid AND aa.attnum = ad.adnum WHERE ad.oid = d.objid), '?')
                      WHEN 'pg_class'::regclass      THEN 'relation '    || coalesce(d.objid::regclass::text, '?')
                      ELSE d.classid::regclass::text || ' oid ' || d.objid
                    END AS what
               FROM pg_depend d
              WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = $1 AND d.deptype = 'n'
              ORDER BY 1, 2`,
            [oid],
          )
        : { rows: [] as { cls: string; what: string }[] };

      const grants = await db.query<{ privilege_type: string }>(
        `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'app_tenant' ORDER BY 1`,
        [table],
      );

      // Classes already reported by a named arm above are listed but not double-counted as blockers;
      // anything else is a dependency nothing in this script models, which is exactly the case that
      // deserves a human.
      const NAMED = new Set(['pg_rewrite', 'pg_proc', 'pg_trigger', 'pg_constraint', 'pg_policy']);

      // The two view oracles police each other. `pg_depend` is authoritative and text-free; the text
      // arm reads `pg_get_viewdef`. A view present in one and absent from the other means one of them
      // is broken, and the whole point of this rewrite is that a broken arm must not read as clean.
      const viewsByText = await viewsQuery(re);
      const viewsByDepend = deps.rows
        .filter((d) => d.cls === 'pg_rewrite')
        .map((d) => d.what.replace(/^view\/rule /, ''))
        .filter((v) => v !== '?');

      reports.push({
        table,
        exists: Boolean(row),
        relkind: row?.relkind ?? null,
        rlsEnabled: row?.rls_enabled ?? false,
        rlsForced: row?.rls_forced ?? false,
        policies: own.rows.map((r) => r.polname),
        bytes: row?.bytes == null ? null : Number(row.bytes),
        dependentViews: viewsByText,
        dependentViewsByDepend: [...new Set(viewsByDepend)].sort(),
        dependentRoutines: await routinesQuery(re),
        triggers: trigs.rows.map((r) => r.name),
        namedDependents: deps.rows.filter((d) => NAMED.has(d.cls)).map((d) => d.what),
        otherDependents: deps.rows.filter((d) => !NAMED.has(d.cls)).map((d) => d.what),
        policiesReferencing: await policiesQuery(re, table),
        inboundFks: fks.rows.map((r) => r.name),
        appTenantPrivs: grants.rows.map((r) => r.privilege_type),
      });
    }
  } finally {
    // A failed connect() makes end() throw too, which would replace the real error with a useless one.
    await db.end().catch(() => undefined);
  }

  // ── Non-vacuity verdict, BEFORE any result is believed ──────────────────────────────────────────
  const unproven = arms.filter((a) => a.population > 0 && !a.proven);
  if (unproven.length > 0) {
    die2(
      `${unproven.length} arm(s) could not prove their matcher against a row that MUST match: ` +
        `${unproven.map((a) => `${a.key} (${a.note})`).join('; ')}. A clean result from an unproven arm is ` +
        'indistinguishable from a query that examined nothing.',
    );
  }

  const flipSet = new Set(tables);
  const blockers: string[] = [];
  for (const r of reports) {
    if (!r.exists) blockers.push(`${r.table}: does not exist in public`);
    // The existence probe deliberately does NOT filter on relkind (the census at :304 and the Prisma
    // fingerprint at :320 both do). Keep it broad so a name that resolves to the WRONG KIND of object is
    // distinguishable from one that is absent — but then say so, because otherwise `exists` is true, the
    // blocker above does not fire, and every OID-keyed arm below happily scans an object that is itself a
    // reader. Assert the kind here rather than narrowing the query, which would make this branch
    // unreachable and would break the `__EFMigrationsHistory` case-folding pin in the test.
    if (r.exists && r.relkind !== 'r' && r.relkind !== 'p') {
      blockers.push(`${r.table}: exists in public but is relkind ${r.relkind ?? '?'}, not an ordinary table`);
    }
    // The UNION of the two view oracles, so a miss by either one still blocks.
    for (const v of [...new Set([...r.dependentViews, ...r.dependentViewsByDepend])].sort()) {
      blockers.push(`${r.table}: view/matview ${v} references it`);
    }
    for (const f of r.dependentRoutines) blockers.push(`${r.table}: function ${f} references it`);
    for (const t of r.triggers) blockers.push(`${r.table}: trigger ${t}`);
    for (const d of r.otherDependents) blockers.push(`${r.table}: pg_depend dependent ${d}`);
  }
  // Where the two oracles disagree, SAY SO rather than quietly taking the union. Both directions have
  // legitimate explanations — a `pg_rewrite` dependency can be a RULE on an ordinary table, which the
  // text arm never looks at, and a viewdef can name the table inside a string literal, which `pg_depend`
  // correctly does not count — so this is a line for the reader, not an exit code. What is not
  // acceptable is an unannotated union: it hides which method found what, and the day one of them stops
  // working the other covers for it silently.
  const oracleSplits = reports.flatMap((r) => {
    const text = new Set(r.dependentViews);
    const depend = new Set(r.dependentViewsByDepend);
    return [
      ...[...depend].filter((v) => !text.has(v)).map((v) => `${r.table}: ${v} — pg_depend only`),
      ...[...text].filter((v) => !depend.has(v)).map((v) => `${r.table}: ${v} — text matcher only`),
    ];
  });
  for (const h of repo.hits.filter((x) => x.kind === 'blocker')) {
    blockers.push(`${h.table}: ${h.file}:${h.line} names \`${h.variant}\` — ${h.why}`);
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          tables,
          note: diffNote || undefined,
          census,
          arms,
          repo: { filesScanned: repo.filesScanned, perRoot: repo.perRoot, variants: repo.variants, hits: repo.hits },
          reports,
          oracleSplits,
          blockers,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(tables, census, arms, repo, reports, flipSet, oracleSplits);
  }

  if (blockers.length === 0) {
    if (!asJson) {
      const unexercised = arms.filter((a) => a.population === 0);
      console.log(`\n✓ No blocker for ${tables.join(', ')}.`);
      if (unexercised.length > 0) {
        console.log(
          `  ⚠ ${unexercised.length} arm(s) searched an EMPTY population and therefore proved nothing on ` +
            `their own: ${unexercised.map((a) => `${a.key} (0 ${a.populationLabel})`).join('; ')}.\n` +
            `    That is a statement about the database, not about these tables — say so in the PR body ` +
            'rather than reporting a clean scan.',
        );
      }
      console.log(
        '  Reported INFO items still belong in the flip PR body — notably app_tenant grants (#126, dead\n' +
          '  DML after the flip), any inbound FK from outside the flip set, and every data-file reference.\n',
      );
    }
    process.exit(0);
  }

  writeSync(2, `\n✖ ${blockers.length} BLOCKER(s):\n\n${blockers.map((b) => `  ${b}`).join('\n')}\n`);
  writeSync(
    2,
    '\nA view, function, trigger or dependent object over the table keeps working after the Prisma model' +
      '\nis deleted, and keeps bypassing whatever scoping the TS stack applied. A data-file reader is' +
      '\ninvisible to `tsc` by construction. Disposition each one BEFORE deleting the model (runbook §0 P2' +
      '\n/ §5 step 5b).\n',
  );
  process.exit(1);
}

/**
 * Prove an arm's matcher end-to-end: take a row the arm MUST match, pull a word out of the very text the
 * arm searches, and re-run the arm's own query with it.
 *
 * The samples are drawn with the arm's own scope predicate on purpose — a sample selected more widely
 * would still be found by a broken arm and would prove nothing about the scope.
 */
async function proveArm(
  key: string,
  label: string,
  population: number,
  populationLabel: string,
  samples: { name: string; text: string }[],
  run: (re: string) => Promise<string[]>,
): Promise<Arm> {
  if (population === 0) {
    return { key, label, population, populationLabel, proven: true, note: 'population is empty — arm NOT EXERCISED' };
  }
  for (const sample of samples) {
    const tokens = sample.text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g);
    if (!tokens || tokens.length === 0) continue;
    const found = await run(wordRe(tokens[0]));
    if (found.includes(sample.name)) {
      return { key, label, population, populationLabel, proven: true, note: `matcher proved against ${sample.name}` };
    }
  }
  return {
    key,
    label,
    population,
    populationLabel,
    proven: false,
    note: `no sample of ${samples.length} could be re-found by the arm's own query`,
  };
}

function printHuman(
  tables: string[],
  census: { tables: number; views: number; matviews: number; foreignTables: number },
  arms: Arm[],
  repo: ReturnType<typeof scanDataFiles>,
  reports: TableReport[],
  flipSet: Set<string>,
  oracleSplits: string[],
): void {
  console.log(
    `\nschema census (public): ${census.tables} tables, ${census.views} views, ${census.matviews} matviews, ` +
      `${census.foreignTables} foreign tables`,
  );
  console.log('\npopulation each arm searched — a hit count is meaningless without it:');
  for (const a of arms) {
    console.log(`  ${a.key.padEnd(10)} ${String(a.population).padStart(5)} ${a.populationLabel.padEnd(58)} ${a.note}`);
  }
  console.log(
    `  ${'datafiles'.padEnd(10)} ${String(repo.filesScanned).padStart(5)} files across ${repo.perRoot.length} pinned roots` +
      `${' '.repeat(30)}${repo.perRoot.map((r) => `${r.path}=${r.files}`).join(' ')}`,
  );

  for (const r of reports) {
    console.log(`\n── ${r.table} ──────────────────────────────────────────────`);
    if (!r.exists) {
      console.log('  ⚠ DOES NOT EXIST in public — check the name before flipping.');
    } else {
      console.log(
        `  exists   yes (relkind ${r.relkind})   RLS ${r.rlsEnabled ? 'enabled' : 'DISABLED'}` +
          `${r.rlsForced ? ' + forced' : ''}, ${r.policies.length} policy(ies)` +
          `${r.policies.length ? ' [' + r.policies.join(', ') + ']' : ''}, ${r.bytes ?? '?'} bytes`,
      );
      console.log(`  app_tenant                      ${r.appTenantPrivs.join(',') || '(none)'}`);
    }
    console.log(`  views/matviews (text matcher)   ${r.dependentViews.join(', ') || 'none'}`);
    console.log(`  views/matviews (pg_depend)      ${r.dependentViewsByDepend.join(', ') || 'none'}`);
    console.log(`  functions referencing it        ${r.dependentRoutines.join(', ') || 'none'}`);
    console.log(`  triggers on it                  ${r.triggers.join(', ') || 'none'}`);
    console.log(`  policies elsewhere referencing  ${r.policiesReferencing.join(', ') || 'none'}`);
    const foreignFks = r.inboundFks.filter((f) => !flipSet.has(f.split('.')[0]));
    console.log(
      `  inbound FKs                     ${r.inboundFks.join(', ') || 'none'}` +
        (foreignFks.length ? `  ← ${foreignFks.length} from OUTSIDE the flip set` : ''),
    );
    console.log(`  pg_depend (named classes)       ${r.namedDependents.join(', ') || 'none'}`);
    console.log(`  pg_depend (OTHER)               ${r.otherDependents.join(', ') || 'none'}`);
  }

  if (oracleSplits.length > 0) {
    console.log('\n⚠ the two view oracles do not agree — read each one before believing either:');
    for (const s of oracleSplits) console.log(`    ${s}`);
  }

  console.log('\n── data files ──────────────────────────────────────────────');
  if (repo.hits.length === 0) {
    console.log(`  no reference to ${tables.join(', ')} in ${repo.filesScanned} files across the pinned roots`);
  }
  for (const h of repo.hits) {
    console.log(`  ${h.kind === 'blocker' ? 'BLOCK' : 'info '} ${h.file}:${h.line}  ${h.variant}  ${h.text}`);
  }
}

main().catch((err) => {
  // Anything reaching here — an unreachable host, bad credentials, a rejected TLS handshake, a thrown
  // query — means nothing was scanned. That is a did-not-run, not a clean bill of health, so it routes
  // through die2 like every other failure path.
  die2(err instanceof Error ? err.message : String(err));
});
