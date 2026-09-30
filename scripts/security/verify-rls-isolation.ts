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
 * EXIT CODES — aligned with checks 16 and 17 as of #124
 *   0  ran, isolation holds
 *   1  ran, found a finding
 *   2  COULD NOT RUN — no connection URL; no RLS-enabled tables (wrong database); every RLS table empty,
 *      so the fail-closed probe had nothing to prove anything against; or a query threw.
 *      Exit 2 is NOT a pass. A gate that reports it as one is the #38 failure mode.
 *
 * The empty-tables guard matters because this check's core assertion is EMPIRICAL: it can only speak for
 * a table that has rows. In production it covered 44 of 100 candidates (36 once the positive control
 * moved to one test tenant, #292) — RLS_MIN_PROBED now fails the run below a floor; the success line
 * reports, because "verified" was being read as "all of them".
 *
 * Safe to run against production: every statement is a read, and the empirical probe runs inside a
 * transaction that is always rolled back.
 *
 * ENVIRONMENT (#292)
 *   RLS_PROBE_ORG_ID  UUID of a populated test tenant — the positive control for a NOBYPASSRLS reader.
 *   RLS_PROBE_ROLE    role the probe assumes; default ci_rls_probe (SELECT-only, NOLOGIN, NOBYPASSRLS —
 *                     scripts/db/ci-readonly-probe-role.sql). Absent role = exit 2, never a skip.
 *   RLS_MIN_PROBED    minimum tables the empirical probe must cover (default 30), else exit 2.
 *   A remote URL must carry sslmode=verify-full (scripts/security/db-tls.ts), else exit 2.
 */
import { readFileSync, writeSync } from 'node:fs';
import { Client } from 'pg';
import { checkVerifyFull, pgClientConfig } from './db-tls';
import { probeOrgIdProblem, resolveMinProbed, resolveProbeRole, runEmpiricalProbe } from './rls-probe';

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

  // TLS is asserted, not inferred: pg@8 aliases require/prefer/verify-ca to verify-full today and has
  // announced that alias will change. A remote URL must say verify-full or this check does not connect.
  const tls = checkVerifyFull(url);
  if (!tls.ok) die2(`refusing to connect — ${tls.reason}`);

  // A least-privilege CI reader is subject to RLS, so counting with an unset org GUC
  // would make every populated table appear empty. A known test tenant is the positive
  // control: it must see rows before the same table is probed with no tenant selected.
  const probeOrganizationId = process.env.RLS_PROBE_ORG_ID || undefined;
  const orgProblem = probeOrgIdProblem(probeOrganizationId);
  if (orgProblem) die2(orgProblem);
  const probeRoleOrProblem = resolveProbeRole(process.env.RLS_PROBE_ROLE);
  if ('problem' in probeRoleOrProblem) die2(probeRoleOrProblem.problem);
  const probeRole = probeRoleOrProblem.role;
  const minOrProblem = resolveMinProbed(process.env.RLS_MIN_PROBED);
  if ('problem' in minOrProblem) die2(minOrProblem.problem);
  const minProbed = minOrProblem.min;

  const db = new Client(pgClientConfig(url));
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

    // ── 2c. Every policy must apply TO public (#292) ────────────────────────────────────────────
    // The empirical probe runs as ci_rls_probe, not app_tenant. That only speaks for app_tenant while
    // every policy binds every role; a policy scoped TO app_tenant alone would not bind the probe role.
    const { rows: scoped } = await db.query<{ tablename: string; policyname: string; roles: string }>(
      `SELECT tablename, policyname, array_to_string(roles, ',') AS roles
         FROM pg_policies
        WHERE schemaname = 'public' AND roles <> ARRAY['public']::name[]
        ORDER BY tablename, policyname`,
    );
    for (const p of scoped) {
      findings.push({
        check: 'policy-role-scope',
        detail: `${p.tablename}.${p.policyname} applies TO ${p.roles}, not public — the empirical probe role is not bound by it, so check 14 cannot speak for this table.`,
      });
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

    // The probe role must exist and must itself obey RLS. Missing = the owner has not yet run the
    // provisioning script; that is did-not-run, loudly, never a silent skip of the empirical probe.
    const { rows: probeRoleRows } = await db.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1`,
      [probeRole],
    );
    if (probeRoleRows.length === 0) {
      die2(
        `the probe role "${probeRole}" does not exist. Run scripts/db/ci-readonly-probe-role.sql ` +
          '(as postgres, psql -v ON_ERROR_STOP=1) — see the header of .github/workflows/nightly-db-controls.yml.',
      );
    }
    if (probeRoleRows[0].rolbypassrls || probeRoleRows[0].rolsuper) {
      die2(`the probe role "${probeRole}" bypasses RLS, so it cannot demonstrate that RLS fails closed.`);
    }

    await db.query('BEGIN');
    try {
      const result = await runEmpiricalProbe(
        db,
        candidates.map((c) => c.relname),
        { probeOrgId: probeOrganizationId, probeRole },
      );
      probed = result.probed;
      findings.push(...result.findings);
    } finally {
      await db.query('ROLLBACK');
    }

    // The empirical check is the one that actually caught #111, and it can only prove anything about a
    // table that HAS ROWS. If every candidate was empty we skipped all of them and proved exactly nothing
    // — a restored-but-unseeded copy, a fresh database, or the wrong target would all sail through with
    // "verified". Structural checks 1-3 above still ran, but they are not what this check is for.
    if (probed === 0) {
      // Print any structural findings BEFORE bailing. The first version of this guard called die2
      // straight away, which threw away real findings from checks 1-3 whenever the probe had nothing to
      // run against — so pointing this at an unseeded staging database with a genuinely bad policy would
      // report "did not run" and never mention the bad policy. Incomplete is not the same as empty-handed.
      if (findings.length > 0) {
        writeSync(2, `\n✖ ${findings.length} RLS isolation finding(s) from the structural checks:\n\n`);
        for (const f of findings) writeSync(2, `  [${f.check}] ${f.detail}\n`);
        writeSync(2, '\n');
      }
      die2(
        `all ${candidates.length} RLS-enabled tables were EMPTY, so the fail-closed probe ran against ` +
          'nothing. Structure was checked; isolation was not. An unseeded or wrong database cannot be ' +
          `certified as isolating.${findings.length > 0 ? ' The findings above still stand.' : ''}`,
      );
    }

    // Coverage floor. Moving the positive control to a single test tenant dropped coverage 44 → 36 of
    // 100 with no signal; a drop to 3 would have printed the same ✓. Below the floor, the empirical
    // probe is too thin to certify isolation — did-not-run, with the structural findings preserved.
    if (probed < minProbed) {
      if (findings.length > 0) {
        writeSync(2, `\n✖ ${findings.length} RLS isolation finding(s):\n\n`);
        for (const f of findings) writeSync(2, `  [${f.check}] ${f.detail}\n`);
        writeSync(2, '\n');
      }
      die2(
        `the empirical probe covered only ${probed} of ${candidates.length} RLS-enabled tables, below ` +
          `RLS_MIN_PROBED=${minProbed}. Seed the probe tenant (RLS_PROBE_ORG_ID) or lower the floor ` +
          `deliberately.${findings.length > 0 ? ' The findings above still stand.' : ''}`,
      );
    }
  } finally {
    await db.end();
  }

  if (findings.length === 0) {
    // Report the COVERAGE, not just the verdict. In production the probe covered 44 (now 36) of 100, so
    // the empirical probe — the part that actually caught #111 — speaks for well under half of them. That
    // was previously invisible: the check said "verified" and a reader reasonably assumed "all of them".
    console.log(
      `✓ RLS tenant isolation verified: fail-closed on unset GUC, one policy per tenant table.\n` +
        `  Empirical probe covered ${probed} of ${candidateCount} RLS-enabled tables ` +
        `(${candidateCount - probed} were empty for the probe tenant, so they prove nothing either way; ` +
        `floor RLS_MIN_PROBED=${minProbed}).`,
    );
    process.exit(0);
  }

  // writeSync, matching die2 and check 17's violation path: process.exit() does not flush an async stderr
  // pipe, and a CI job that sees exit 1 with the finding list dropped has learned almost nothing.
  let report = `\n✖ ${findings.length} RLS isolation finding(s):\n\n`;
  for (const f of findings) report += `  [${f.check}] ${f.detail}\n`;
  report += '\nSee issue #111 and packages/db/prisma/manual/2026-08-02-fix-rls-*.sql\n';
  writeSync(2, report);
  process.exit(1);
}

main().catch((err) => {
  // An unreachable host, bad credentials, a rejected handshake, a thrown query — all mean isolation was
  // never verified. That is a did-not-run, not a clean bill of health.
  die2(err instanceof Error ? err.message : String(err));
});
