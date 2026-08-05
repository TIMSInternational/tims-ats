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
 *   RLS enabled + forced  → tenant-scoped → an app path may write it as app_tenant → grant is LEGITIMATE
 *   no RLS                → not tenant-scoped → nothing writes it under TenantScope → grant is DEAD
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
 * Exits 0 if every table `app_tenant` can write is either Prisma-owned or RLS-protected, 1 on any
 * violation, and 1 if it cannot run (fail closed — an unrunnable privilege check is not a pass).
 * Read-only: every statement is a SELECT, safe against production.
 */
import { readFileSync } from 'node:fs';
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

async function main(): Promise<void> {
  loadDbEnv();
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('✖ verify-tenant-grants: no DIRECT_URL or DATABASE_URL — check DID NOT RUN (not a pass).');
    process.exit(1);
  }

  // The Prisma schema is the definition of "a table the TS app legitimately writes as app_tenant".
  // Reusing the ownership check's own parser keeps the two from drifting.
  const prismaOwned = new Set(parsePrismaTables('packages/db/prisma/schema'));
  if (prismaOwned.size === 0) {
    console.error('✖ verify-tenant-grants: parsed ZERO Prisma tables — refusing to run (would flag everything).');
    process.exit(1);
  }

  const db = new Client({ connectionString: url });
  const violations: Violation[] = [];
  try {
    await db.connect();
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
  console.error('✖ verify-tenant-grants failed to run:', err instanceof Error ? err.message : err);
  process.exit(1);
});
