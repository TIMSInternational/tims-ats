#!/usr/bin/env npx tsx
/**
 * RLS tenant-isolation regression guard — issue #111.
 *
 * WHY THIS EXISTS, AND WHY IT IS A LIVE CHECK RATHER THAN A UNIT TEST
 * -------------------------------------------------------------------
 * On 2026-08-02 two policy families were found in production that existed in ZERO repo files:
 *
 *   org_isolation  USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL))   -- 67 tables
 *   allow_all      USING (true)                                                                 --  9 tables
 *
 * Postgres ORs PERMISSIVE policies together, so both defeated the correct fail-closed
 * `tenant_isolation` policy sitting beside them. An unset org GUC returned every tenant's rows
 * instead of zero (32/32 users across all 15 orgs), and the `allow_all` tables — including
 * `user_roles`, the RBAC grant table — had no effective isolation in ANY GUC state.
 *
 * A static test over the repo's migrations would NOT have caught this: the policies were applied
 * out of band and were never in the repo. Only querying the live database finds it. That is the
 * whole lesson of #111 — live DDL diverges from the migrations, so tenant isolation must be
 * asserted against the database itself.
 *
 * USAGE
 *   npx tsx scripts/security/verify-rls-isolation.ts            # uses DIRECT_URL, else DATABASE_URL
 *   DATABASE_URL="postgres://..." npx tsx scripts/security/verify-rls-isolation.ts
 *
 * Exits 0 if isolation holds, 1 if any check fails. Safe to run against production: every
 * statement is a read, and the empirical probe runs inside a transaction that is always rolled back.
 */
import { readFileSync, writeSync } from 'node:fs';
import { Client } from 'pg';

/**
 * Load DIRECT_URL / DATABASE_URL from packages/db/.env when they aren't already in the environment,
 * so `/gate` check 14 runs standalone without a `source` incantation. Deliberately minimal — no new
 * dependency, and it never overwrites a value the caller already exported.
 */
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

/** The ONLY policy expected on a tenant-scoped table. Anything else is a finding. */
const EXPECTED_TENANT_POLICY = 'tenant_isolation';

/**
 * Global, org-agnostic catalogs that are RLS-exempt by design and legitimately carry `allow_all`.
 * Documented in docs/architecture/table-ownership.md. Dropping their policy would deny-all and
 * break permission resolution for every tenant.
 */
const GLOBAL_CATALOGS = new Set(['permissions', 'platform_owner_emails']);

/** Substrings in a USING clause that let a policy evaluate true independently of the org GUC. */
const GUC_INDEPENDENT_ESCAPES = [
  'IS NULL', // e.g. `OR (current_org_id() IS NULL)` — the Defect 1 shape
];

/**
 * Functions no policy may call, with the reason. `current_org_id()` was created by the same
 * out-of-band Supabase migration that introduced the Defect 1 `org_isolation` family
 * (`supabase_migrations` row 20260531055730). It survives in production but is now fully orphaned:
 * zero policies call it and it has zero `pg_depend` dependents (verified 2026-08-03, #115).
 *
 * WHY THIS CHECK EXISTS RATHER THAN JUST DROPPING THE FUNCTION
 * ------------------------------------------------------------
 * Dropping it is its own reviewed change. Meanwhile there is a real gap: a NEW policy named
 * `tenant_isolation` whose USING clause calls `current_org_id()` — without the literal `IS NULL`
 * escape — passes every other check here AND passes the /gate check-16 schema diff (which only
 * asserts the schema has not changed, never that it is correct). This closes that gap by name.
 *
 * MATCHED WITH A PAREN, DELIBERATELY: a bare substring test for `current_org_id` matches
 * `current_setting('app.current_org_id', true)` — the CORRECT idiom — and produced a false
 * "100 policies use current_org_id" reading during the #115 investigation.
 */
const BANNED_POLICY_FUNCTIONS: ReadonlyArray<{ fn: string; why: string }> = [
  {
    fn: 'current_org_id',
    why: "orphaned #111-era function that returns NULL rather than failing closed; policies must read current_setting('app.current_org_id', true) directly",
  },
];

type Finding = { check: string; detail: string };

/**
 * Exit 2 — could not run. Aligned with checks 16 and 17 (#124): 0 clean · 1 finding · 2 never looked.
 *
 * `writeSync(2, …)` rather than `console.error`: Node's stderr is ASYNC when it is a pipe and
 * `process.exit()` does not flush pending writes, so the reason a check did not run is exactly what gets
 * lost for the callers that capture output — a CI job, or the failure-path tests below.
 */
function die2(reason: string): never {
  writeSync(2, `⚠ RLS ISOLATION CHECK DID NOT RUN — ${reason}\n  This is exit 2, not a pass. Nothing was verified.\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  loadDbEnv();
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    die2(
      'no DIRECT_URL or DATABASE_URL in the environment or packages/db/.env.\n' +
        '  Run: bash scripts/dev/setup-db-env.sh   (see issue #41)\n' +
        '  Use the SESSION pooler (:5432) — :6543 cannot SET LOCAL ROLE.',
    );
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  const findings: Finding[] = [];
  /** Tables the fail-closed probe actually exercised. Zero means nothing was verified — see below. */
  let probed = 0;
  /** RLS-enabled tables found, i.e. the probe's denominator. */
  let candidateCount = 0;

  try {
    // ── 1. No unexpected policy names anywhere in the public schema ────────────────────────────
    const { rows: unexpected } = await db.query<{ tablename: string; policyname: string; qual: string }>(
      `SELECT tablename, policyname, coalesce(qual, '') AS qual
         FROM pg_policies
        WHERE schemaname = 'public' AND policyname <> $1
        ORDER BY tablename, policyname`,
      [EXPECTED_TENANT_POLICY],
    );
    for (const p of unexpected) {
      if (p.policyname === 'allow_all' && GLOBAL_CATALOGS.has(p.tablename)) continue;
      findings.push({
        check: 'unexpected-policy',
        detail: `${p.tablename}.${p.policyname} — only "${EXPECTED_TENANT_POLICY}" is expected on tenant tables (allow_all is permitted solely on ${[...GLOBAL_CATALOGS].join(', ')}). A second PERMISSIVE policy ORs past the guard.`,
      });
    }

    // ── 2. No tenant policy may contain a GUC-independent escape hatch ─────────────────────────
    const { rows: policies } = await db.query<{ tablename: string; policyname: string; qual: string }>(
      `SELECT tablename, policyname, coalesce(qual, '') AS qual
         FROM pg_policies WHERE schemaname = 'public'`,
    );
    for (const p of policies) {
      if (GLOBAL_CATALOGS.has(p.tablename)) continue;
      for (const escape of GUC_INDEPENDENT_ESCAPES) {
        if (p.qual.toUpperCase().includes(escape)) {
          findings.push({
            check: 'guc-independent-escape',
            detail: `${p.tablename}.${p.policyname} USING contains "${escape}" — it can evaluate true with no org GUC set, which fails OPEN. qual: ${p.qual.replace(/\s+/g, ' ').slice(0, 160)}`,
          });
        }
      }
    }

    // ── 2b. No policy may call a banned function (#115) ────────────────────────────────────────
    // Covers the gap the check-16 schema diff cannot: check 16 asserts the schema has not CHANGED,
    // so a newly added policy is caught only until its baseline is re-captured, and a policy that
    // was already there is never flagged at all. This is a semantic assertion, not a diff.
    for (const p of policies) {
      for (const { fn, why } of BANNED_POLICY_FUNCTIONS) {
        // Paren-anchored: a bare substring match would also hit current_setting('app.current_org_id').
        if (new RegExp(`\\b${fn}\\s*\\(`).test(p.qual)) {
          findings.push({
            check: 'banned-policy-function',
            detail: `${p.tablename}.${p.policyname} USING calls ${fn}() — ${why}. qual: ${p.qual.replace(/\s+/g, ' ').slice(0, 160)}`,
          });
        }
      }
    }

    // ── 3. No RLS-enabled table left with zero policies (deny-all breaks the app) ──────────────
    const { rows: bare } = await db.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relrowsecurity
          AND NOT EXISTS (
            SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
          )`,
    );
    for (const t of bare) {
      findings.push({
        check: 'no-policy',
        detail: `${t.relname} has RLS enabled but zero policies — every read denied.`,
      });
    }

    // ── 4. THE EMPIRICAL CHECK: unset GUC must return zero rows ────────────────────────────────
    // This is the one that actually caught #111. Structure alone is not proof.
    const { rows: candidates } = await db.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          AND c.relname <> ALL($1::text[])
        ORDER BY c.relname`,
      [[...GLOBAL_CATALOGS]],
    );

    // No RLS-enabled tables at all is not "isolation is perfect", it is "this is not our database".
    // Same vacuous-pass class as check 17's (#124): the loop below simply never runs, `findings` stays
    // empty, and the script congratulates itself on a database it never examined.
    candidateCount = candidates.length;
    if (candidates.length === 0) {
      die2(
        'found ZERO RLS-enabled tables in `public` — this is not the application database. ' +
          'Check which database DIRECT_URL/DATABASE_URL points at.',
      );
    }

    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('app.current_org_id', '', true)`);
      for (const { relname } of candidates) {
        const total = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${relname}"`);
        if (total.rows[0].n === '0') continue; // empty table proves nothing either way

        probed++;
        await db.query('SET LOCAL ROLE app_tenant');
        const seen = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${relname}"`);
        await db.query('RESET ROLE');

        if (seen.rows[0].n !== '0') {
          findings.push({
            check: 'FAILS-OPEN',
            detail: `${relname}: app_tenant with NO org GUC sees ${seen.rows[0].n} of ${total.rows[0].n} rows. Tenant isolation must fail CLOSED — this should be 0.`,
          });
        }
      }
    } finally {
      await db.query('ROLLBACK');
    }

    // The empirical check is the one that actually caught #111, and it can only prove anything about a
    // table that HAS ROWS. If every candidate was empty we skipped all of them and proved exactly nothing
    // — a restored-but-unseeded copy, a fresh database, or the wrong target would all sail through with
    // "verified". Structural checks 1-3 above still ran, but they are not what this check is for.
    if (probed === 0) {
      die2(
        `all ${candidates.length} RLS-enabled tables were EMPTY, so the fail-closed probe ran against ` +
          'nothing. Structure was checked; isolation was not. An unseeded or wrong database cannot be ' +
          'certified as isolating.',
      );
    }
  } finally {
    await db.end();
  }

  if (findings.length === 0) {
    // Report the COVERAGE, not just the verdict. In production only 46 of 102 RLS tables hold rows, so
    // the empirical probe — the part that actually caught #111 — speaks for well under half of them. That
    // was previously invisible: the check said "verified" and a reader reasonably assumed "all of them".
    console.log(
      `✓ RLS tenant isolation verified: fail-closed on unset GUC, one policy per tenant table.\n` +
        `  Empirical probe covered ${probed} of ${candidateCount} RLS-enabled tables ` +
        `(${candidateCount - probed} were empty, so they prove nothing either way).`,
    );
    process.exit(0);
  }

  console.error(`\n✖ ${findings.length} RLS isolation finding(s):\n`);
  for (const f of findings) console.error(`  [${f.check}] ${f.detail}`);
  console.error('\nSee issue #111 and packages/db/prisma/manual/2026-08-02-fix-rls-*.sql\n');
  process.exit(1);
}

main().catch((err) => {
  // An unreachable host, bad credentials, a rejected handshake, a thrown query — all mean isolation was
  // never verified. That is a did-not-run, not a clean bill of health.
  die2(err instanceof Error ? err.message : String(err));
});
