#!/usr/bin/env npx tsx
/**
 * `app_tenant` least-privilege guard — issue #126.
 *
 * WHY THIS EXISTS
 * ---------------
 * Production carries this default privilege (verified 2026-08-04 via `pg_default_acl`):
 *
 *   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 *     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;   -- default_acl {app_tenant=arwd/postgres}
 *
 * So EVERY table `postgres` creates in `public` gets tenant DML automatically, whether or not
 * `app_tenant` has any business writing it. That is opt-out, not opt-in, and nothing noticed.
 *
 * A CORRECTION TO THE ORIGINAL #126 FRAMING: the grant is applied at CREATE TABLE time, not at
 * ownership-flip time. An ownership flip does NOT re-grant, so a REVOKE is durable. The exposure is
 * therefore not about flips at all — which is how 11 `qrtz_*` tables and `__EFMigrationsHistory` sat
 * there unnoticed while the issue was scoped to "flipped tables".
 *
 * WHAT COUNTS AS A VIOLATION — and the correction that shaped it
 * --------------------------------------------------------------
 * The first version of this check flagged every non-Prisma table: 20 of them. A cross-model reviewer
 * pointed out that would have been a PRODUCTION WRITE OUTAGE if acted on, and it was right.
 *
 * The C# strangler writes its tables UNDER TenantScope, and `TenantScope.cs:46` issues
 * `SET LOCAL ROLE app_tenant` — that is HOW those writes are RLS-enforced. So "EF owns it" does not
 * mean "app_tenant never writes it"; for a tenant-scoped EF table the grant is REQUIRED.
 *
 * The discriminator is RLS, and it follows from the design rather than being a heuristic:
 *
 *   RLS enabled + ≥1 policy → tenant-scoped → an app path may write it as app_tenant → grant is LEGITIMATE
 *   no RLS                  → not tenant-scoped → nothing writes it under TenantScope → grant is DEAD
 *
 * Note "enabled + ≥1 policy", NOT "forced" — that is what the predicate below actually tests, and it is
 * the correct one: `relforcerowsecurity` changes behaviour only for a table's OWNER, and `app_tenant` is a
 * non-owner NOBYPASSRLS role, so plain `relrowsecurity` already constrains it. Do NOT "fix" this toward
 * FORCE; that would flag RLS-enabled-but-unforced EF tables and lead straight back to the outage above.
 *
 * Confirmed per writer for all 13 of the no-RLS tables:
 *   fx_rates   FxRateDbContext / FxRateWriteRepository run on a PLAIN connection as the owner role,
 *              explicitly NOT under TenantScope ("fx_rates is RLS-exempt").
 *   qrtz_* ×11 no Quartz source file references TenantScope; the scheduler owns its own connection.
 *   __EFMigrationsHistory  written by psql-applied idempotent scripts as `postgres`.
 *
 * So: 13 violations, not 20. The 7 excluded are access_reviews, critical_roles, successors (flipped)
 * and the 4 hris_* — all RLS-forced, all written by C# as app_tenant, all legitimately granted.
 *
 * SEVERITY, STATED HONESTLY. `app_tenant` is NOLOGIN and NOBYPASSRLS, reachable only via
 * `SET LOCAL ROLE app_tenant` from the app's own connection inside a transaction. Exploiting this needs
 * app-level SQL injection or a compromised app process — NOT remotely exploitable. But containing exactly
 * that is what app_tenant + RLS exist for, and these 13 have no RLS, so the grant is the only guard.
 * fx_rates is the sharpest case: global (no organization_id) and it feeds every tenant's compensation
 * and pay-equity maths.
 *
 * WHY A LIVE CHECK RATHER THAN A UNIT TEST
 * ----------------------------------------
 * Same reason as check 14 (#111): grants live in the database, not the repo. No amount of migration
 * reading finds a privilege that a default ACL conferred silently. And because the default ACL is
 * deliberately left in place (see #126 — narrowing it means explicitly granting ~99 Prisma tables, a
 * far larger blast radius), this check is what stops the next new table from quietly inheriting DML.
 *
 * USAGE
 *   npx tsx scripts/security/verify-tenant-grants.ts            # uses DIRECT_URL, else DATABASE_URL
 *   ALLOW_KNOWN_VIOLATIONS=1 npx tsx scripts/security/verify-tenant-grants.ts   # report, exit 0
 *
 * EXIT CODES — aligned with `/gate` check 16 (`schema-baseline.sh`) as of #124
 *   0  ran, and `app_tenant` holds write privileges only where it legitimately may
 *   1  ran, and found a violation
 *   2  COULD NOT RUN — no connection URL; the Prisma schema parsed to zero tables; the target database
 *      has no `app_tenant` role or barely any of the declared tables (wrong database); or the query threw.
 *      Exit 2 is NOT a pass. A gate that reports it as one is the #38 failure mode.
 *
 * The two "wrong database" guards exist because a clean result and a vacuous one are indistinguishable
 * downstream: the grant query returns zero rows both when `app_tenant` holds no DML anywhere and when we
 * are pointed somewhere with nothing to hold DML on. Cheap to conflate locally; a nightly job reading a
 * mistyped or rotated CI secret (#124) would report green forever.
 *
 * WHY 2 AND NOT 1 (changed 2026-08-05; it returned 1 for both before)
 * ------------------------------------------------------------------
 * Fail-closed was always right, but returning the SAME code for "found a violation" and "never looked"
 * made the two indistinguishable to any caller — the two states could only be told apart by reading
 * stderr. That is fine for a human running `/gate` and useless for an automated job, which is why #124's
 * own acceptance criterion ("the job must distinguish exit 1 from exit 2 and fail loudly on 2") was
 * literally unsatisfiable for this script. Now it is satisfiable.
 *
 * `tests/security/verify-tenant-grants-failure-paths.test.ts` pins this contract offline. Per #38, a gate
 * whose did-not-run path is untested is not a gate.
 *
 * Read-only: every statement is a SELECT, safe against production.
 */
import { readFileSync, writeSync } from 'node:fs';
import { Client } from 'pg';
import { parsePrismaTables } from '../table-ownership.mjs';

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

const WRITE_PRIVS = ['INSERT', 'UPDATE', 'DELETE'] as const;

/**
 * Tables that legitimately keep NARROWED tenant DML despite not being a Prisma model.
 * `audit_logs` / `data_access_logs` are `efcoreAppendOnly`: the TS app appends to them, so INSERT is
 * required and UPDATE/DELETE must never be granted. Production already matches this (they are the only
 * two tables in the schema with an `INSERT,SELECT`-only grant), so this is recording an existing
 * deliberate narrowing, not creating an exemption.
 */
const APPEND_ONLY_ALLOWED: Readonly<Record<string, ReadonlySet<string>>> = {
  audit_logs: new Set(['INSERT']),
  data_access_logs: new Set(['INSERT']),
};

interface Violation {
  table: string;
  privs: string[];
  rlsEnabled: boolean;
  policies: number;
}

/**
 * Exit 2 — could not run. Phrased so the reason is never mistaken for "found nothing".
 *
 * Writes with `writeSync(2, …)` rather than `console.error`: Node's stderr is ASYNC when it is a pipe,
 * and `process.exit()` does not flush pending writes. Since the whole point of exit 2 is that a human or
 * a CI log learns WHY nothing was verified, losing the message to a race would quietly defeat it — and
 * every caller that captures output (the failure-path tests, a CI job) pipes stderr.
 */
function die2(reason: string): never {
  writeSync(
    2,
    `⚠ TENANT GRANT CHECK DID NOT RUN — ${reason}\n  This is exit 2, not a pass. No privilege was verified.\n`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  loadDbEnv();
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    die2('no DIRECT_URL or DATABASE_URL in the environment or packages/db/.env.');
  }

  // The Prisma schema is the definition of "a table the TS app legitimately writes as app_tenant".
  // Reusing the ownership check's own parser keeps the two from drifting.
  const prismaOwned = new Set(parsePrismaTables('packages/db/prisma/schema'));
  if (prismaOwned.size === 0) {
    // Not a violation — an unusable input. Flagging all ~99 Prisma tables would be a false alarm so
    // large it would get the check switched off, which is worse than the check not existing.
    die2('parsed ZERO tables from packages/db/prisma/schema — refusing to run (would flag everything).');
  }

  const db = new Client({ connectionString: url });
  const violations: Violation[] = [];
  try {
    await db.connect();

    // ── Guard against a VACUOUS PASS ────────────────────────────────────────────────────────────────
    // The grant query below returns zero rows when `app_tenant` holds no DML anywhere — which is the
    // clean result — but ALSO when we are simply pointed at the wrong database: an empty one, a fresh
    // one, or a project where the role was never created. Both look identical downstream, so without
    // this the script would print "least privilege intact" and exit 0 having verified nothing. That is
    // the #38 failure mode one level down: the check ran, and certified grants it never read.
    //
    // It matters much more now than when this was a local-only check. #124 puts the connection string in
    // a CI secret, and a mistyped or rotated secret pointing somewhere harmless is exactly how a nightly
    // control goes quietly green forever.
    const { rows: roleRows } = await db.query<{ ok: boolean }>(
      `SELECT true AS ok FROM pg_roles WHERE rolname = 'app_tenant'`,
    );
    if (roleRows.length === 0) {
      die2(
        'the role `app_tenant` does not exist in the target database — this is almost certainly the ' +
          'wrong connection string, not a database with perfect least privilege.',
      );
    }

    // And confirm we are looking at THIS application's schema, not merely some database that happens to
    // have an app_tenant role. A majority threshold rather than "at least one": prod carries 100% of the
    // declared tables, a fresh `prisma db push` likewise, so anything below half means wrong or
    // half-built database — while still tolerating a handful of in-flight renames.
    const { rows: presentRows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
      [[...prismaOwned]],
    );
    const present = Number(presentRows[0]?.n ?? 0);
    if (present * 2 < prismaOwned.size) {
      die2(
        `only ${present} of the ${prismaOwned.size} tables declared by the Prisma schema exist in the ` +
          'target database — refusing to certify grants against a schema this different. Check which ' +
          'database DIRECT_URL/DATABASE_URL points at.',
      );
    }
    // `string_agg` + split rather than `array_agg`: the driver's text[] parsing is one more moving part
    // in a check whose whole job is to be trustworthy, and privilege_type values are bare words.
    // The pg_class lookup is scoped to `public` on the JOIN so a same-named table in another schema
    // (e.g. storage.*) cannot supply the RLS flags.
    const { rows } = await db.query<{
      table_name: string;
      privs: string;
      rls_enabled: boolean;
      policies: string;
    }>(
      `SELECT g.table_name,
              string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) AS privs,
              coalesce(bool_or(c.relrowsecurity), false)                           AS rls_enabled,
              coalesce(max((SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)), 0) AS policies
         FROM information_schema.role_table_grants g
         LEFT JOIN pg_namespace n ON n.nspname = 'public'
         LEFT JOIN pg_class     c ON c.relname = g.table_name AND c.relnamespace = n.oid
        WHERE g.table_schema = 'public'
          AND g.grantee      = 'app_tenant'
          AND g.privilege_type = ANY($1::text[])
        GROUP BY g.table_name
        ORDER BY g.table_name`,
      [[...WRITE_PRIVS]],
    );

    for (const r of rows) {
      if (prismaOwned.has(r.table_name)) continue; // Prisma-owned → tenant DML is the whole point

      // CORRECTED 2026-08-04 after a cross-model reviewer caught the original invariant being wrong.
      //
      // "Not Prisma-owned" does NOT imply "app_tenant never writes it". The C# strangler writes its
      // tables UNDER TenantScope, and `TenantScope.cs:46` issues `SET LOCAL ROLE app_tenant` — that is
      // precisely HOW those writes get RLS-enforced. So an EF-owned, tenant-scoped table legitimately
      // NEEDS this grant, and revoking it would break live writes (HRIS sync, access-review attest,
      // succession).
      //
      // The discriminator is RLS, and it is not a heuristic — it follows from the design. A table with
      // RLS enabled + forced is tenant-scoped, so an app path may write it under TenantScope as
      // app_tenant. A table with NO RLS is by definition not tenant-scoped, so nothing writes it under
      // TenantScope, so app_tenant DML on it is dead. Confirmed per writer:
      //   fx_rates  → FxRateDbContext/FxRateWriteRepository run on a PLAIN connection as the owner role,
      //               explicitly NOT under TenantScope ("fx_rates is RLS-exempt").
      //   qrtz_*    → no Quartz file references TenantScope at all; the scheduler owns its connection.
      //   __EFMigrationsHistory → written by psql-applied idempotent scripts as `postgres`.
      if (r.rls_enabled && Number(r.policies) > 0) continue;

      const privs = r.privs.split(',').filter(Boolean);
      const allowed = APPEND_ONLY_ALLOWED[r.table_name];
      const offending = allowed ? privs.filter((p) => !allowed.has(p)) : privs;
      if (offending.length === 0) continue;
      violations.push({
        table: r.table_name,
        privs: offending,
        rlsEnabled: r.rls_enabled,
        policies: Number(r.policies),
      });
    }
  } finally {
    await db.end();
  }

  if (violations.length === 0) {
    // State the real invariant, not the narrow one. "only on Prisma-owned tables" is the exact framing
    // that produced the near-outage this check was rewritten to prevent (#126) — a passing message that
    // misstates what passed teaches the wrong rule to whoever reads it next.
    console.log(
      '✓ app_tenant holds write privileges only on tables that are Prisma-owned or RLS-protected' +
        ' (least privilege intact).',
    );
    process.exit(0);
  }

  // Every surviving violation is a no-RLS table by definition (the RLS-forced ones are skipped above as
  // legitimately written by C# under TenantScope), so the grant really is the only guard on each of them.
  console.error(
    `\n✖ app_tenant has write privileges on ${violations.length} table(s) that have NO RLS and that no` +
      ` application path writes as app_tenant (#126):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.table.padEnd(28)} ${v.privs.join(',').padEnd(20)} [no RLS — grant is the only guard]`);
  }
  console.error(
    '\nFix: packages/db/prisma/manual/2026-08-04-revoke-app-tenant-dml.sql (+ its .ROLLBACK.sql).' +
      '\nThe default ACL that causes this is deliberately left in place — see #126 for why — so this' +
      '\ncheck is what catches the next table that inherits it.\n',
  );
  if (process.env.ALLOW_KNOWN_VIOLATIONS === '1') {
    console.error('ALLOW_KNOWN_VIOLATIONS=1 — reporting only, exiting 0.\n');
    process.exit(0);
  }
  process.exit(1);
}

main().catch((err) => {
  // Anything reaching here — an unreachable host, bad credentials, a rejected TLS handshake, a thrown
  // parser — means the privileges were never read. That is a did-not-run, not a clean bill of health,
  // so it routes through die2 like the other paths. This deliberately does NOT distinguish "connection
  // refused" from a programming bug: both leave the check unperformed, and treating a bug as a pass is
  // the failure mode being guarded against.
  die2(err instanceof Error ? err.message : String(err));
});
