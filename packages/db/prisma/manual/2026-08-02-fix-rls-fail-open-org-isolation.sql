-- SECURITY FIX (issue #111): remove the `org_isolation` PERMISSIVE policy family, which made tenant RLS
-- fail OPEN on an unset org GUC across 67 production tables.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────────
-- Two PERMISSIVE policies coexisted on 67 tables. Postgres ORs permissive policies together, so the
-- weaker one wins:
--
--   tenant_isolation (the intended, fail-CLOSED control — installed by the RLS migration):
--     USING (organization_id = (NULLIF(current_setting('app.current_org_id', true), ''))::uuid)
--     → unset GUC ⇒ `organization_id = NULL` ⇒ NULL ⇒ row NOT visible.  Correct.
--
--   org_isolation (undocumented, provenance unknown — see below):
--     USING ((organization_id = current_org_id()) OR (current_org_id() IS NULL))
--     → unset GUC ⇒ current_org_id() IS NULL ⇒ TRUE ⇒ EVERY row visible.  Fail-OPEN.
--
--   current_org_id() is: SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
--
-- `users` and `notifications` were wider still, adding `OR (organization_id IS NULL)`.
-- `organizations` used `id` in place of `organization_id`.
--
-- ── EMPIRICALLY VERIFIED IN PROD, 2026-08-02 (transaction-scoped, rolled back) ────────────────────────
--   BEGIN; SET LOCAL ROLE app_tenant; SELECT count(*) FROM users;              -- → 32  (ALL users, ALL 15 orgs)
--   BEGIN; SET LOCAL ROLE app_tenant; SET LOCAL app.current_org_id='<uuid>';
--          SELECT count(*) FROM users;                                          -- →  0  (correctly scoped)
--   BEGIN; DROP POLICY org_isolation ON users; SET LOCAL ROLE app_tenant;
--          SELECT count(*) FROM users;                                          -- →  0  (this fix works)
-- `app_tenant` has rolbypassrls = false, so RLS genuinely applies to it.
--
-- ── IMPACT ASSESSMENT ────────────────────────────────────────────────────────────────────────────────
-- HIGH, but NOT an active data leak on the evidence available:
--   * `anon` / `authenticated` hold ZERO grants on the public schema, so PostgREST is not an exposure path.
--   * The only two app paths that assume the `app_tenant` role set the role AND the GUC atomically in the
--     same transaction — packages/db/src/tenant-client.ts:41-42 and :74-75, and the C# TenantScope.
--   * The plain `db` client connects as `postgres` (rolbypassrls = true); RLS never applied to it by design.
-- What was lost was the BACKSTOP: the guarantee that a missed TenantScope, a new un-scoped code path, or
-- SQL injection under `app_tenant` returns ZERO rows rather than every tenant's rows.
--
-- ── WHY DROPPING IS NON-BREAKING ─────────────────────────────────────────────────────────────────────
-- When the GUC IS set, org_isolation evaluates `(organization_id = guc) OR false` — an identical row set
-- to tenant_isolation. Dropping a permissive policy can only ever remove visibility, and here it removes
-- none. The two diverge only when the GUC is unset, which is precisely the defect. Corroborated by 22
-- tables (access_reviews, data_access_logs, employee_demographics, …) that already run in production on
-- tenant_isolation alone.
--
-- Pre-verified before applying:
--   * All 67 org_isolation tables ALSO carry tenant_isolation → none is left with zero policies.
--   * `users` and `notifications` have ZERO rows with organization_id IS NULL → the extra OR-clause
--     protected nothing.
--   * organizations.tenant_isolation correctly keys on `id`, matching org_isolation's variant.
--
-- ── PROVENANCE (unresolved — see #111) ───────────────────────────────────────────────────────────────
-- `org_isolation`, `allow_all` and `current_org_id()` appear in ZERO repo files and were applied
-- out-of-band. This corroborates the #63 finding that "One DDL path" (00-master-plan.md:68) is not true
-- today. `current_org_id()` is deliberately LEFT IN PLACE by this migration — it may have other callers,
-- and dropping a function is a separate, riskier change.
--
-- NOT covered here: the 9 `allow_all (qual: true)` tables, incl. calibration_members / calibration_votes
-- (whose session-subquery policy the ownership ledger claims exists but does not). Tracked in #111.
--
-- APPLY (failure-atomic):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<DIRECT_PROD_URL>" \
--     -f packages/db/prisma/manual/2026-08-02-fix-rls-fail-open-org-isolation.sql
-- VERIFY:
--   BEGIN; SET LOCAL ROLE app_tenant; SELECT count(*) FROM users; ROLLBACK;   -- MUST be 0
-- ROLLBACK: packages/db/prisma/manual/2026-08-02-fix-rls-fail-open-org-isolation.ROLLBACK.sql
-- NOTE: re-run after any migration that recreates these policies.

DO $$
DECLARE
  r record;
  dropped int := 0;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'org_isolation'
    ORDER BY tablename
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', r.tablename);
    dropped := dropped + 1;
  END LOOP;

  RAISE NOTICE 'org_isolation policies dropped: %', dropped;

  -- Fail loudly if any table would be left with NO policy at all (RLS on + zero policies = deny-all,
  -- which is fail-closed but would break the application).
  PERFORM 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname);

  IF FOUND THEN
    RAISE EXCEPTION 'ABORT: at least one RLS-enabled table would be left with zero policies';
  END IF;
END $$;
