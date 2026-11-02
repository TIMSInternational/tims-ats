-- ROLLBACK twin of 20261029050359_platform_audit_events.sql (WP-03 PR-5a).
-- Drops ONLY platform_audit_events (its indexes, triggers and policy go with it) and forgets the EF history
-- row, so the forward script can be re-applied. The shared public.tims_append_only_guard() is NOT dropped:
-- audit_logs and data_access_logs depend on it. Safe to re-run.
-- WARNING: the table is append-only audit evidence. Run this only if it holds no rows worth keeping.

START TRANSACTION;

DROP TABLE IF EXISTS platform_audit_events;

DELETE FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events';

COMMIT;
