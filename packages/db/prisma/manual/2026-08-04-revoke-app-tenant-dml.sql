-- ============================================================================================
-- #126 — REVOKE app_tenant's write privileges on the 13 tables nothing writes as app_tenant.
--
-- WHY. Production carries this default privilege (pg_default_acl, verified 2026-08-04):
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
--
-- so every table `postgres` creates in `public` inherits tenant DML whether it needs it or not.
-- 20 tables hold app_tenant DML without being Prisma-owned; 13 of those are genuinely dead (see below)
-- and are what this script revokes. The other 7 are RLS-forced EF tables that C# writes AS app_tenant
-- under TenantScope — revoking those would break production. See PART 2 below.
--
-- SEVERITY, STATED PLAINLY. `app_tenant` is NOLOGIN and NOBYPASSRLS: it is reachable only via
-- `SET LOCAL ROLE app_tenant` from the app's own connection inside a transaction, so exploiting this
-- needs app-level SQL injection or a compromised app process. It is NOT remotely exploitable. But
-- containing exactly that scenario is what `app_tenant` + RLS exist for, and every table revoked here has
-- RLS DISABLED entirely (0 policies), so the grant is the only thing in the way. That is also precisely
-- why they are safe to revoke: no RLS ⇒ not tenant-scoped ⇒ nothing writes them under TenantScope.
--
-- WHAT THIS DOES NOT DO. It does not touch the default ACL, so a NEWLY created table will still
-- inherit tenant DML. That was a deliberate decision (#126): narrowing the default means explicitly
-- granting ~99 Prisma-owned tables, and a table missed there breaks tenant writes at runtime. The
-- regression guard instead is `scripts/security/verify-tenant-grants.ts` (`/gate` check 17), which
-- fails the moment a table with NO RLS holds app_tenant DML.
--
-- SELECT IS DELIBERATELY RETAINED on every table here. Revoking reads is a separate, riskier change:
-- `information_schema`/catalog reads and any diagnostic query would change behaviour, and no TS path
-- needs these reads either, so it buys little. Revoke DML, re-verify, then consider SELECT separately.
--
-- SAFETY / PRE-FLIGHT (all verified 2026-08-04 against prod, read-only):
--   * The §3(f) policy scan returns 0 rows — no RLS policy on ANY table references these tables, so
--     no policy's USING/WITH CHECK clause depends on app_tenant being able to read or write them.
--   * Zero views, zero matviews and zero functions in `public` reference these tables
--     (scripts/db/pre-flip-scan.ts).
--   * WRITER-VERIFIED, per table, which is the check the first draft of this script skipped:
--     fx_rates → FxRateDbContext/FxRateWriteRepository run on a PLAIN connection as the owner role,
--     explicitly NOT under TenantScope; qrtz_* → no Quartz source file references TenantScope at all;
--     __EFMigrationsHistory → written by psql-applied idempotent scripts as `postgres`.
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

-- ── PART 2: REMOVED. It would have caused a production write outage. ──────────────────────────
-- An earlier draft of this script ALSO revoked DML on access_reviews, critical_roles, successors and
-- the 4 hris_* tables, on the reasoning "C# owns them, so no TS path writes them". That reasoning was
-- WRONG, and a cross-model reviewer caught it before this was applied.
--
-- The C# strangler writes its tables UNDER TenantScope, and TenantScope.cs:46 issues
--   SET LOCAL ROLE app_tenant
-- because that is HOW those writes become RLS-enforced. So for a tenant-scoped EF table the app_tenant
-- grant is not dead privilege — it is load-bearing. Revoking it would have broken HRIS sync,
-- access-review attestation and succession writes in production, and the only detection would have been
-- the write failures themselves.
--
-- "EF owns the table" and "app_tenant never writes it" are different claims. Do not conflate them again.
-- The discriminator is RLS: RLS-forced ⇒ tenant-scoped ⇒ possibly written as app_tenant ⇒ KEEP the grant.
-- Every table in Part 1 has NO RLS, which is exactly why nothing writes it under TenantScope.

-- ── POST-APPLY ASSERTION (run manually; not part of the transactions above). ───────────────────
-- Must return zero rows.
--
--   SELECT g.table_name, g.privilege_type
--     FROM information_schema.role_table_grants g
--    WHERE g.table_schema='public' AND g.grantee='app_tenant'
--      AND g.privilege_type IN ('INSERT','UPDATE','DELETE')
--      AND g.table_name IN (
--        '__EFMigrationsHistory','fx_rates',
--        'qrtz_blob_triggers','qrtz_calendars','qrtz_cron_triggers','qrtz_fired_triggers',
--        'qrtz_job_details','qrtz_locks','qrtz_paused_trigger_grps','qrtz_scheduler_state',
--        'qrtz_simple_triggers','qrtz_simprop_triggers','qrtz_triggers')
--    ORDER BY 1,2;
--
-- NOTE the 7 RLS-forced EF tables (access_reviews, critical_roles, successors, hris_*) are deliberately
-- ABSENT from that list. They MUST still hold app_tenant DML. If they ever appear without it, something
-- revoked them by mistake and C# writes are broken.
