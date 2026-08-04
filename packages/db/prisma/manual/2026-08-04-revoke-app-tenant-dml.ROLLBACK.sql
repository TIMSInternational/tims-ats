-- ============================================================================================
-- ROLLBACK for 2026-08-04-revoke-app-tenant-dml.sql (#126).
--
-- Restores app_tenant's INSERT/UPDATE/DELETE on the 13 tables the forward script revoked, returning
-- them to the `{app_tenant=arwd/postgres}` ACL the default privilege had conferred.
--
-- WHEN TO RUN THIS. Only if revoking breaks something — i.e. if some path really does write one of
-- these tables as app_tenant, contradicting the analysis. If that happens, the finding is more
-- interesting than the rollback: it means a TS path writes an EF-owned table, which is an ownership
-- violation worth its own issue. Capture WHICH table and WHICH code path before reverting.
--
-- SELECT was never revoked by the forward script, so it is not re-granted here.
--
-- IDEMPOTENT: re-granting an existing privilege is a no-op.
--
-- APPLY:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/prisma/manual/2026-08-04-revoke-app-tenant-dml.ROLLBACK.sql
-- THEN re-capture the baseline, since grants are part of it:
--   bash scripts/db/schema-baseline.sh capture
-- NOTE: after rolling back, `/gate` check 17 (verify-tenant-grants) will FAIL again by design —
-- that is the check correctly reporting the restored exposure, not a broken check.
-- ============================================================================================

BEGIN;

-- The 13 tables with no RLS. (An earlier draft also had a Part 2 for the 7 RLS-forced EF tables; that
-- was removed from the forward script because revoking those would break C# writes, so there is
-- nothing to restore for them here either.)
GRANT INSERT, UPDATE, DELETE ON TABLE public."__EFMigrationsHistory" TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.fx_rates TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_blob_triggers TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_calendars TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_cron_triggers TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_fired_triggers TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_job_details TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_locks TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_paused_trigger_grps TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_scheduler_state TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_simple_triggers TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_simprop_triggers TO app_tenant;
GRANT INSERT, UPDATE, DELETE ON TABLE public.qrtz_triggers TO app_tenant;

COMMIT;
