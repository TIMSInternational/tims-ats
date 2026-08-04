-- ============================================================================================
-- #126 — REVOKE app_tenant's write privileges on the 20 tables it has no business writing.
--
-- WHY. Production carries this default privilege (pg_default_acl, verified 2026-08-04):
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
--
-- so every table `postgres` creates in `public` inherits tenant DML whether it needs it or not.
-- 20 tables currently hold write privileges that no TS code path uses.
--
-- SEVERITY, STATED PLAINLY. `app_tenant` is NOLOGIN and NOBYPASSRLS: it is reachable only via
-- `SET LOCAL ROLE app_tenant` from the app's own connection inside a transaction, so exploiting this
-- needs app-level SQL injection or a compromised app process. It is NOT remotely exploitable. But
-- containing exactly that scenario is what `app_tenant` + RLS exist for, and 13 of the 20 have RLS
-- DISABLED entirely (0 policies), so for those the grant is the only thing in the way. Those 13 are
-- revoked first below, in their own transaction, for that reason.
--
-- WHAT THIS DOES NOT DO. It does not touch the default ACL, so a NEWLY created table will still
-- inherit tenant DML. That was a deliberate decision (#126): narrowing the default means explicitly
-- granting ~99 Prisma-owned tables, and a table missed there breaks tenant writes at runtime. The
-- regression guard instead is `scripts/security/verify-tenant-grants.ts` (`/gate` check 17), which
-- fails the moment any non-Prisma table holds app_tenant DML.
--
-- SELECT IS DELIBERATELY RETAINED on every table here. Revoking reads is a separate, riskier change:
-- `information_schema`/catalog reads and any diagnostic query would change behaviour, and no TS path
-- needs these reads either, so it buys little. Revoke DML, re-verify, then consider SELECT separately.
--
-- SAFETY / PRE-FLIGHT (all verified 2026-08-04 against prod, read-only):
--   * The §3(f) policy scan returns 0 rows — no RLS policy on ANY table references these tables, so
--     no policy's USING/WITH CHECK clause depends on app_tenant being able to read or write them.
--   * Zero views, zero matviews and zero functions in `public` reference the flipped pair.
--   * `audit_logs` and `data_access_logs` are NOT in this script: they are `efcoreAppendOnly` and the
--     TS app genuinely appends to them. They already hold INSERT,SELECT only — the one pre-existing
--     deliberate narrowing in the schema, and the precedent this script follows.
--   * No Prisma-owned table appears below. `verify-tenant-grants.ts` derives that set from
--     `packages/db/prisma/schema` via the ownership check's own parser.
--
-- IDEMPOTENT: `REVOKE` on a privilege that is already absent is a no-op, not an error.
-- REVERSIBLE: 2026-08-04-revoke-app-tenant-dml.ROLLBACK.sql restores the exact prior grants.
--
-- APPLY (Federico — this is prod DCL):
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/prisma/manual/2026-08-04-revoke-app-tenant-dml.sql
-- THEN, in the same session, re-capture the baseline and re-run the guards:
--   bash scripts/db/schema-baseline.sh capture      # grants are IN the baseline — it WILL diff
--   npx tsx scripts/security/verify-tenant-grants.ts   # must print ✓ and exit 0
--   npx tsx scripts/security/verify-rls-isolation.ts   # must stay exit 0
-- ============================================================================================

-- ── PART 1: the 13 with NO RLS — the grant is their only guard, so these matter most. ──────────
BEGIN;

-- Migration history. A tenant-role write here could forge or delete applied-migration records,
-- which is also what makes the EF path's self-recording property untrustworthy if abused.
REVOKE INSERT, UPDATE, DELETE ON TABLE public."__EFMigrationsHistory" FROM app_tenant;

-- FX rates feed compensation and DEI pay-equity maths for EVERY tenant. This table is global (no
-- organization_id), so a write here is inherently cross-tenant.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.fx_rates FROM app_tenant;

-- Quartz scheduler internals. Writes here manipulate job schedules, triggers and locks for the whole
-- platform. Quartz connects as its own principal and never as app_tenant.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_blob_triggers FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_calendars FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_cron_triggers FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_fired_triggers FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_job_details FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_locks FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_paused_trigger_grps FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_scheduler_state FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_simple_triggers FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_simprop_triggers FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qrtz_triggers FROM app_tenant;

COMMIT;

-- ── PART 2: the 7 EF-owned tables that DO have forced fail-closed RLS. ─────────────────────────
-- Lower risk (RLS bounds the damage to the caller's own org) but still dead privilege: C# owns every
-- one of these and no TS path writes them.
BEGIN;

-- Ownership-flipped: EF Core is the sole writer.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.access_reviews FROM app_tenant;   -- flip #1, #63/#65
REVOKE INSERT, UPDATE, DELETE ON TABLE public.critical_roles FROM app_tenant;   -- flip #2, #69
REVOKE INSERT, UPDATE, DELETE ON TABLE public.successors FROM app_tenant;       -- flip #2, #69

-- EF-native: created greenfield for the HRIS domain, never Prisma-owned, never had a TS writer.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.hris_connectors FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.hris_external_employees FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.hris_sync_record_errors FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.hris_sync_runs FROM app_tenant;

COMMIT;

-- ── POST-APPLY ASSERTION (run manually; not part of the transactions above). ───────────────────
-- Must return zero rows.
--
--   SELECT g.table_name, g.privilege_type
--     FROM information_schema.role_table_grants g
--    WHERE g.table_schema='public' AND g.grantee='app_tenant'
--      AND g.privilege_type IN ('INSERT','UPDATE','DELETE')
--      AND g.table_name IN (
--        '__EFMigrationsHistory','fx_rates','access_reviews','critical_roles','successors',
--        'hris_connectors','hris_external_employees','hris_sync_record_errors','hris_sync_runs',
--        'qrtz_blob_triggers','qrtz_calendars','qrtz_cron_triggers','qrtz_fired_triggers',
--        'qrtz_job_details','qrtz_locks','qrtz_paused_trigger_grps','qrtz_scheduler_state',
--        'qrtz_simple_triggers','qrtz_simprop_triggers','qrtz_triggers')
--    ORDER BY 1,2;
