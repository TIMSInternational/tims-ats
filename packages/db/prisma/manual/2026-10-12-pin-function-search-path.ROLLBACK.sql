-- ============================================================================================
-- ROLLBACK for 2026-10-12-pin-function-search-path.sql.
--
-- Removes the function-level search_path setting from both functions, returning them to resolving
-- unqualified names against the caller's search_path.
--
-- WHEN TO RUN THIS. Only if pinning breaks something. Neither body references an object outside
-- pg_catalog, so a breakage would mean the deployed body differs from the committed baseline — capture
-- `SELECT pg_get_functiondef('public.<name>()'::regprocedure)` before reverting; that drift is the
-- more important finding.
--
-- NOTE: re-applying a 2026-07-17-*-immutable.sql script after this rollback re-pins the guard, because
-- its CREATE OR REPLACE now carries the SET clause.
--
-- IDEMPOTENT: RESET on a setting that is already absent is a no-op.
--
-- APPLY:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/prisma/manual/2026-10-12-pin-function-search-path.ROLLBACK.sql
-- THEN re-capture the baseline:
--   bash scripts/db/schema-baseline.sh capture
-- AND regenerate every services/Tims.Platform/db/flip-ddl/*.sql from its own `-- Regenerate:` line, adding
-- `--out <that file>`: each embeds the baseline's capture timestamp, so a re-capture alone fails tests/db/extract-table-ddl.test.ts
-- (byte-identity). Commit the baseline and all flip-DDL files together, exactly as for the forward script.
-- ============================================================================================

BEGIN;

ALTER FUNCTION public.current_org_id() RESET search_path;
ALTER FUNCTION public.tims_append_only_guard() RESET search_path;

COMMIT;
