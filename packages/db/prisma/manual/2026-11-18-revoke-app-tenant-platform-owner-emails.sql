-- ============================================================================================
-- Least privilege for public.platform_owner_emails: app_tenant keeps no privileges on it.
--
-- WHAT. The platform-owner allowlist received SELECT, INSERT, UPDATE, DELETE for app_tenant from the
-- schema's default privilege (packages/db/baseline/prod-public-schema.sql, the ACL entry for this
-- table), like every table `postgres` creates in `public`. This script revokes all four.
--
-- WHY ALL FOUR, INCLUDING SELECT. app_tenant is the role the application drops to for tenant-scoped
-- work (`SET LOCAL ROLE app_tenant`: packages/db/src/tenant-client.ts, and TenantScope in C#). Nothing
-- reads or writes this table in that mode. Verified 2026-11-18 against the repository:
--   * TypeScript — every access goes through the base `db` client, never `tenantDb`:
--       packages/api/src/routers/platform/users.ts (list / add / remove owner emails)
--       apps/web/lib/auth/platform-owner-provisioning.ts (first sign-in, inside db.$transaction)
--       packages/db/prisma/seed.ts (local seed)
--   * C# — services/Tims.Platform has no entity, query or migration that references the table.
--   * Database — no RLS policy, view or routine in `public` references it (the baseline mentions the
--     table only in its own definition, key, unique index, allow_all policy, RLS flag and grants).
-- The reasoning in 2026-08-04-revoke-app-tenant-dml.sql for keeping SELECT (catalog and diagnostic
-- reads) does not apply here: no read path exists under app_tenant, so there is nothing to keep.
--
-- WHAT THIS DOES NOT CHANGE. The base connection role, ci_readonly, ci_rls_probe and
-- backup_drill_reader keep their grants, the allow_all policy stays, and the default privilege is
-- untouched (see the 2026-08-04 script for why). `/gate` check 17 is unaffected: it flags tenant DML on
-- tables without RLS, and its SELECT coverage threshold is a majority of Prisma tables, not all of them.
--
-- GUARD. Refuses to run unless the target is the TIMS ATS database: a Supabase-managed database (the
-- `supabase_migrations` schema exists, as in services/Tims.Platform/db/flip-ddl, with the condition
-- inverted because this script is for production) that has both `public.platform_owner_emails` and the
-- `app_tenant` role. The refusal raises inside the transaction, so a wrong target changes nothing.
--
-- IDEMPOTENT: revoking a privilege that is already absent is a no-op; a second run succeeds unchanged.
-- ATOMIC: one transaction, with a post-condition check before COMMIT.
-- REVERSIBLE: 2026-11-18-revoke-app-tenant-platform-owner-emails.ROLLBACK.sql restores the prior grants.
--
-- APPLY (owner — this is prod DCL; direct connection, not the pooler):
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/prisma/manual/2026-11-18-revoke-app-tenant-platform-owner-emails.sql
-- VERIFY (expects zero rows):
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'platform_owner_emails' AND grantee = 'app_tenant';
-- THEN, in the same session:
--   npx tsx scripts/security/verify-tenant-grants.ts   # must print ✓ and exit 0
--   bash scripts/db/schema-baseline.sh capture         # grants are IN the baseline — check 16 diffs until then
-- and regenerate every services/Tims.Platform/db/flip-ddl/*.sql from its own `-- Regenerate:` line (adding
-- `--out <that file>`), since each embeds the baseline's capture timestamp. Commit them together.
-- SMOKE after apply: the platform owner can list, add and remove owner emails on /platform/support, and
-- an allowlisted address still signs in as owner.
-- ============================================================================================

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'supabase_migrations') THEN
    RAISE EXCEPTION 'REFUSED: not a Supabase-managed database (no supabase_migrations schema). This script is for the TIMS ATS production database.';
  END IF;
  IF to_regclass('public.platform_owner_emails') IS NULL THEN
    RAISE EXCEPTION 'REFUSED: public.platform_owner_emails does not exist here. Wrong database?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    RAISE EXCEPTION 'REFUSED: role app_tenant does not exist here. Wrong database?';
  END IF;
END $$;

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_owner_emails FROM app_tenant;

-- Post-condition, still inside the transaction. has_table_privilege also counts privileges reached
-- through PUBLIC or role membership, so this fails if any other grant still gives app_tenant access.
DO $$ BEGIN
  IF has_table_privilege('app_tenant', 'public.platform_owner_emails', 'SELECT')
     OR has_table_privilege('app_tenant', 'public.platform_owner_emails', 'INSERT')
     OR has_table_privilege('app_tenant', 'public.platform_owner_emails', 'UPDATE')
     OR has_table_privilege('app_tenant', 'public.platform_owner_emails', 'DELETE') THEN
    RAISE EXCEPTION 'ABORT: app_tenant still has access to public.platform_owner_emails after the REVOKE (a PUBLIC grant or role membership?). Nothing was changed.';
  END IF;
END $$;

COMMIT;
