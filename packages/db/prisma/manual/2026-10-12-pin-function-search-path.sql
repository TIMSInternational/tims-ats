-- ============================================================================================
-- Pin search_path on the two functions in `public` (Supabase database lint 0011,
-- `function_search_path_mutable`).
--
-- WHAT. A function without a `SET search_path` clause resolves unqualified names against the CALLER's
-- search_path. Pinning it to '' means every unqualified name resolves only against `pg_catalog`
-- (which Postgres always searches implicitly), so no role can shadow a built-in such as
-- `current_setting` or `nullif` by creating a same-named object earlier on its own path.
--
-- SCOPE. Exactly the two functions `public` contains, per the committed baseline
-- (packages/db/baseline/prod-public-schema.sql — the only two CREATE FUNCTION statements in it):
--   * public.current_org_id()          — LANGUAGE sql STABLE; body uses only current_setting/NULLIF/::uuid
--   * public.tims_append_only_guard()  — LANGUAGE plpgsql trigger; body is a RAISE using TG_* variables
-- Neither body references any object outside pg_catalog, so '' changes no behaviour. Both are
-- SECURITY INVOKER; this is defence in depth, not the closing of a privilege-escalation path.
--
-- WHY ALTER AND NOT CREATE OR REPLACE. ALTER FUNCTION ... SET changes only proconfig: the body, owner,
-- ACL and the four triggers that reference tims_append_only_guard() are untouched. The guard's
-- canonical CREATE OR REPLACE (Tims.Domain.Audit.AuditImmutability.BuildAppendOnlySql, mirrored by
-- the two 2026-07-17-*-immutable.sql scripts) now carries the same SET clause, so re-applying either of
-- those scripts later KEEPS the pin instead of silently resetting it.
--
-- current_org_id() is not called by any RLS policy (ddl-reconciliation-2026-08-03.md §3b) and dropping
-- it is tracked separately (#121). Pinning it is harmless either way and clears the lint until then.
--
-- IDEMPOTENT: re-running sets the same value. REVERSIBLE: 2026-10-12-pin-function-search-path.ROLLBACK.sql.
-- ATOMIC: one transaction — both functions are pinned or neither is.
--
-- APPLY (owner — this is prod DDL; direct connection, not the pooler):
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/prisma/manual/2026-10-12-pin-function-search-path.sql
-- VERIFY (expects two rows, each with proconfig = {"search_path=\"\""}):
--   SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname IN ('current_org_id', 'tims_append_only_guard');
-- THEN re-capture the baseline (proconfig is part of it, so check 16 WILL diff until you do):
--   bash scripts/db/schema-baseline.sh capture
-- ============================================================================================

BEGIN;

ALTER FUNCTION public.current_org_id() SET search_path = '';
ALTER FUNCTION public.tims_append_only_guard() SET search_path = '';

COMMIT;
