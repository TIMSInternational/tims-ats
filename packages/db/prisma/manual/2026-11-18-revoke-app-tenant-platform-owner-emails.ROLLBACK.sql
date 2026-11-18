-- ============================================================================================
-- ROLLBACK for 2026-11-18-revoke-app-tenant-platform-owner-emails.sql.
--
-- Restores app_tenant's SELECT, INSERT, UPDATE, DELETE on public.platform_owner_emails — the
-- `app_tenant=arwd/postgres` ACL entry the default privilege had conferred (see the baseline).
--
-- WHEN TO RUN THIS. Only if the revoke breaks something, which would mean some path does touch the
-- table as app_tenant, contradicting the analysis in the forward script. Capture WHICH code path
-- (error text, route) before reverting: that path is the finding.
--
-- Same guard as the forward script: refuses to run unless this is the TIMS ATS database.
-- IDEMPOTENT: re-granting an existing privilege is a no-op.
--
-- APPLY:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/prisma/manual/2026-11-18-revoke-app-tenant-platform-owner-emails.ROLLBACK.sql
-- THEN re-capture the baseline (grants are part of it) and regenerate every
-- services/Tims.Platform/db/flip-ddl/*.sql from its own `-- Regenerate:` line, as after the forward script:
--   bash scripts/db/schema-baseline.sh capture
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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_owner_emails TO app_tenant;

COMMIT;
