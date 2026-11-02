-- WP-03 privilege statement for platform_audit_events (PR-5a).
-- The table is written only by the platform (owner) connection. Supabase default privileges hand every new
-- public table to the tenant roles, so the migration removes that access; this file is the standalone,
-- re-runnable form of the same statement, for re-asserting it after any privilege drift.
-- It removes privileges only and adds none.

REVOKE ALL ON platform_audit_events FROM PUBLIC, app_tenant, anon, authenticated;
