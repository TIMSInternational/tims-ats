#!/usr/bin/env npx tsx
/**
 * Pre-flip DATABASE-SIDE dependency scan — issue #132, for the ownership-flip runbook §5.
 *
 * WHY THIS EXISTS
 * ---------------
 * The runbook's P2 reader sweep is six `grep` strategies over the repo. All six share one blind spot:
 * a dependency that lives in the DATABASE rather than in a file. A view, a materialized view or a
 * `plpgsql` function over the table being flipped is a real reader that is invisible to
 *
 *   * `tsc`                     — it is not TypeScript,
 *   * `scripts/table-ownership.mjs` — that only greps `@@map` / `ToTable`,
 *   * every P2 grep             — the object is not in the repo at all.
 *
 * #111 is the standing proof that production contains objects no repo file describes, so "we would have
 * noticed" is not an argument. Flip #2 (#69) ran these queries by hand, one at a time, and came back
 * clean — this script exists so the next flip runs one command instead of remembering four, and so a
 * non-clean result is impossible to skim past.
 *
 * WHAT IT CHECKS, per table
 *   1. BLOCKER  views / matviews whose definition references the table
 *   2. BLOCKER  functions whose body references the table
 *   3. INFO     RLS policies on OTHER tables that reference this one (runbook §3(f) pre-REVOKE scan)
 *   4. INFO     inbound foreign keys (a FK from outside the flip set means the flip is not self-contained)
 *   5. INFO     app_tenant grants (#126 — dead DML after the flip)
 *   6. INFO     existence, RLS enabled/forced, policy count, size
 *
 * BLOCKER vs INFO: a view or function must be dispositioned BEFORE the model is deleted, because
 * deleting the model does not break them — they keep working against the table and keep bypassing
 * whatever scoping the TS stack used to apply. Everything else is reported for the PR body.
 *
 * USAGE
 *   npx tsx scripts/db/pre-flip-scan.ts critical_roles successors
 *   npx tsx scripts/db/pre-flip-scan.ts --json surveys survey_responses
 *
 * Exits 0 if no BLOCKER found, 1 if any BLOCKER found, and 1 if it cannot run (fail closed — an
 * unrunnable scan is not a clean scan). Read-only: every statement is a SELECT, safe against production.
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

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

interface Report {
  table: string;
  exists: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: string[];
  bytes: number | null;
  dependentViews: string[];
  dependentRoutines: string[];
  policiesReferencing: string[];
  inboundFks: string[];
  appTenantPrivs: string[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const tables = args.filter((a) => !a.startsWith('--'));
  if (tables.length === 0) {
    console.error('usage: npx tsx scripts/db/pre-flip-scan.ts [--json] <table>...');
    process.exit(1);
  }

  loadDbEnv();
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('✖ pre-flip-scan: no DIRECT_URL or DATABASE_URL — scan DID NOT RUN (not a clean scan).');
    process.exit(1);
  }

  // \y is a Postgres word boundary; without it `successors` would also match inside other identifiers.
  const wordRe = (t: string) => `\\y${t}\\y`;
  const db = new Client({ connectionString: url });
  const reports: Report[] = [];

  try {
    await db.connect();
    for (const table of tables) {
      const re = wordRe(table);

      const meta = await db.query<{
        exists: boolean;
        rls_enabled: boolean;
        rls_forced: boolean;
        bytes: string | null;
      }>(
        `SELECT to_regclass('public.'||$1) IS NOT NULL AS exists,
                coalesce(c.relrowsecurity,false)      AS rls_enabled,
                coalesce(c.relforcerowsecurity,false) AS rls_forced,
                pg_relation_size(c.oid)               AS bytes
           FROM pg_namespace n LEFT JOIN pg_class c ON c.relname=$1 AND c.relnamespace=n.oid
          WHERE n.nspname='public'`,
        [table],
      );

      const own = await db.query<{ polname: string }>(
        `SELECT p.polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname=$1 ORDER BY 1`,
        [table],
      );

      const views = await db.query<{ name: string }>(
        `SELECT n.nspname||'.'||c.relname AS name
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind IN ('v','m') AND pg_get_viewdef(c.oid) ~* $1 ORDER BY 1`,
        [re],
      );

      const routines = await db.query<{ name: string }>(
        `SELECT n.nspname||'.'||p.proname AS name
           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema')
            AND p.prosrc ~* $1 ORDER BY 1`,
        [re],
      );

      // §3(f): a policy on ANOTHER table whose USING/WITH CHECK references this one. Such a policy
      // depends on the table remaining readable by whatever role evaluates it — so it must be
      // dispositioned before revoking anything (#126) and before the flip.
      const refPolicies = await db.query<{ name: string }>(
        `SELECT c.relname||'.'||p.polname AS name
           FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
          WHERE (coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* $1
              OR coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* $1)
            AND c.relname <> $2
          ORDER BY 1`,
        [re, table],
      );

      const fks = await db.query<{ name: string }>(
        `SELECT tc.table_name||'.'||kcu.column_name AS name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu       ON tc.constraint_name=kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
          WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
            AND ccu.table_name=$1
          ORDER BY 1`,
        [table],
      );

      const grants = await db.query<{ privilege_type: string }>(
        `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema='public' AND table_name=$1 AND grantee='app_tenant'
          ORDER BY 1`,
        [table],
      );

      reports.push({
        table,
        exists: meta.rows[0]?.exists ?? false,
        rlsEnabled: meta.rows[0]?.rls_enabled ?? false,
        rlsForced: meta.rows[0]?.rls_forced ?? false,
        policies: own.rows.map((r) => r.polname),
        bytes: meta.rows[0]?.bytes == null ? null : Number(meta.rows[0].bytes),
        dependentViews: views.rows.map((r) => r.name),
        dependentRoutines: routines.rows.map((r) => r.name),
        policiesReferencing: refPolicies.rows.map((r) => r.name),
        inboundFks: fks.rows.map((r) => r.name),
        appTenantPrivs: grants.rows.map((r) => r.privilege_type),
      });
    }
  } finally {
    await db.end();
  }

  if (asJson) {
    console.log(JSON.stringify({ tables: reports }, null, 2));
  }

  const blockers: string[] = [];
  const flipSet = new Set(tables);

  for (const r of reports) {
    if (!asJson) {
      console.log(`\n── ${r.table} ──────────────────────────────────────────────`);
      if (!r.exists) {
        console.log('  ⚠ DOES NOT EXIST in public — check the name before flipping.');
      } else {
        console.log(
          `  exists   yes   RLS ${r.rlsEnabled ? 'enabled' : 'DISABLED'}` +
            `${r.rlsForced ? ' + forced' : ''}, ${r.policies.length} policy(ies)` +
            `${r.policies.length ? ' [' + r.policies.join(', ') + ']' : ''}, ${r.bytes ?? '?'} bytes`,
        );
        console.log(`  app_tenant  ${r.appTenantPrivs.join(',') || '(none)'}`);
      }
      console.log(`  views/matviews referencing it   ${r.dependentViews.join(', ') || 'none'}`);
      console.log(`  functions referencing it        ${r.dependentRoutines.join(', ') || 'none'}`);
      console.log(`  policies elsewhere referencing  ${r.policiesReferencing.join(', ') || 'none'}`);
      // A FK from a table also being flipped is fine — both sides move together.
      const foreignFks = r.inboundFks.filter((f) => !flipSet.has(f.split('.')[0]));
      console.log(
        `  inbound FKs                     ${r.inboundFks.join(', ') || 'none'}` +
          (foreignFks.length ? `  ← ${foreignFks.length} from OUTSIDE the flip set` : ''),
      );
    }

    if (!r.exists) blockers.push(`${r.table}: does not exist in public`);
    for (const v of r.dependentViews) blockers.push(`${r.table}: view/matview ${v} references it`);
    for (const f of r.dependentRoutines) blockers.push(`${r.table}: function ${f} references it`);
  }

  if (blockers.length === 0) {
    console.log(
      `\n✓ No database-side blocker for ${tables.join(', ')}.` +
        `\n  Reported items above still belong in the flip PR body — notably app_tenant grants (#126,` +
        `\n  dead DML after the flip) and any inbound FK from outside the flip set.\n`,
    );
    process.exit(0);
  }

  console.error(`\n✖ ${blockers.length} database-side BLOCKER(s):\n`);
  for (const b of blockers) console.error(`  ${b}`);
  console.error(
    '\nA view or function over the table keeps working after the Prisma model is deleted, and keeps' +
      '\nbypassing whatever scoping the TS stack applied. Disposition each one BEFORE deleting the model' +
      '\n(runbook §0 P2 / §5).\n',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('✖ pre-flip-scan failed to run:', err instanceof Error ? err.message : err);
  process.exit(1);
});
