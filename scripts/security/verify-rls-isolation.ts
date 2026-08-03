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
import { Client } from 'pg';

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

type Finding = { check: string; detail: string };

async function main(): Promise<void> {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('✖ Set DIRECT_URL or DATABASE_URL. Use the session pooler (:5432), not :6543.');
    process.exit(1);
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  const findings: Finding[] = [];

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

    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('app.current_org_id', '', true)`);
      for (const { relname } of candidates) {
        const total = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${relname}"`);
        if (total.rows[0].n === '0') continue; // empty table proves nothing either way

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
  } finally {
    await db.end();
  }

  if (findings.length === 0) {
    console.log('✓ RLS tenant isolation verified: fail-closed on unset GUC, one policy per tenant table.');
    process.exit(0);
  }

  console.error(`\n✖ ${findings.length} RLS isolation finding(s):\n`);
  for (const f of findings) console.error(`  [${f.check}] ${f.detail}`);
  console.error('\nSee issue #111 and packages/db/prisma/manual/2026-08-02-fix-rls-*.sql\n');
  process.exit(1);
}

main().catch((err) => {
  console.error('✖ verify-rls-isolation failed to run:', err instanceof Error ? err.message : err);
  process.exit(1);
});
