-- SECURITY FIX #111 Defect 2: remove the `allow_all` PERMISSIVE policy from the 7 tenant-scoped join
-- tables, where it defeated a correct fail-closed `tenant_isolation` session-subquery policy.
--
-- Companion to 2026-08-02-fix-rls-fail-open-org-isolation.sql (Defect 1). Same root cause — a second
-- PERMISSIVE policy OR-ing past the real guard — but a strictly worse blast radius (see below).
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────────
-- These 7 tables have no `organization_id` of their own; they are join/child tables whose tenancy is
-- derived from a parent. A correct policy for that already exists and is properly fail-closed:
--
--   tenant_isolation  USING + WITH CHECK:
--     EXISTS (SELECT 1 FROM <parent> par
--              WHERE par.id = <this>.<fk>
--                AND par.organization_id = (NULLIF(current_setting('app.current_org_id', true), ''))::uuid)
--
--   table                  parent               fk
--   ---------------------  -------------------  -----------------
--   user_roles             roles                role_id
--   role_permissions       roles                role_id
--   user_teams             teams                team_id
--   interview_evaluators   interviews           interview_id
--   calibration_members    calibration_sessions session_id
--   calibration_votes      calibration_sessions session_id
--   learning_path_courses  learning_paths       path_id
--
-- Alongside it sat `allow_all` — PERMISSIVE, FOR ALL, TO public, `USING (true)`. Postgres ORs permissive
-- policies, so `true` wins unconditionally.
--
-- WORSE THAN DEFECT 1: `org_isolation` at least scoped correctly when the GUC was set, and only failed
-- open when it was unset. `allow_all` is `true` regardless — these tables had NO effective DB-level tenant
-- isolation in any state. Isolation rested entirely on application-level filtering.
--
-- ── EMPIRICALLY VERIFIED IN PROD, 2026-08-02 (before the fix) ────────────────────────────────────────
--   table                  total rows   visible unset-GUC   visible scoped-GUC
--   user_roles                     12                  12                   12   <- RBAC grant table
--   role_permissions             3033                3033                 3033
--   user_teams                      1                   1                    1
--   calibration_members             2                   2                    2
--   calibration_votes               2                   2                    2
--   interview_evaluators            0                   0                    0   (empty today)
--   learning_path_courses           0                   0                    0   (empty today)
--
-- ── DRY RUN OF THIS FIX (transaction-scoped, rolled back) ────────────────────────────────────────────
-- After dropping allow_all: unset GUC -> 0 for every table. Scoped GUC -> a correct subset
-- (role_permissions 271/3033, user_roles 1/12). A per-org sweep across all 15 orgs summed to EXACTLY the
-- true row count for every table — no row is hidden from the org that owns it.
--
-- ── DELIBERATELY NOT TOUCHED ─────────────────────────────────────────────────────────────────────────
-- `permissions` and `platform_owner_emails` also carry `allow_all`, but it is their ONLY policy and it is
-- correct: both are global, org-agnostic catalogs, documented as RLS-exempt in
-- docs/architecture/table-ownership.md (the same category as ai_agents and fx_rates). Dropping allow_all
-- there would leave them with zero policies under RLS = deny-all, breaking permission resolution for every
-- tenant. They are left exactly as they are.
--
-- ── CORRECTION TO AN EARLIER CLAIM ───────────────────────────────────────────────────────────────────
-- An earlier pass on #111 asserted that `calibration_members`/`calibration_votes` had NO session-subquery
-- policy and that table-ownership.md:109 was factually wrong. That was incorrect — the policy exists
-- exactly as the ledger describes, including WITH CHECK. The ledger was right; the erroneous "correction"
-- has been reverted.
--
-- APPLY (failure-atomic):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<SESSION_POOLER_URI>" \
--     -f packages/db/prisma/manual/2026-08-02-fix-rls-allow-all-join-tables.sql
-- VERIFY:
--   BEGIN; SET LOCAL ROLE app_tenant; SELECT count(*) FROM user_roles; ROLLBACK;   -- MUST be 0
-- ROLLBACK: packages/db/prisma/manual/2026-08-02-fix-rls-allow-all-join-tables.ROLLBACK.sql

DO $$
DECLARE
  r text;
  dropped int := 0;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'user_roles', 'role_permissions', 'user_teams', 'interview_evaluators',
    'calibration_members', 'calibration_votes', 'learning_path_courses'
  ]
  LOOP
    -- Refuse to drop unless a tenant_isolation backstop is actually present on this table.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = r AND policyname = 'tenant_isolation'
    ) THEN
      RAISE EXCEPTION 'ABORT: % has no tenant_isolation policy; dropping allow_all would deny all access', r;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS allow_all ON public.%I', r);
    dropped := dropped + 1;
  END LOOP;

  RAISE NOTICE 'allow_all policies dropped from tenant-scoped join tables: %', dropped;

  -- The two global catalogs must still have their allow_all, or permission resolution breaks.
  PERFORM 1 FROM pg_policies
   WHERE schemaname = 'public' AND policyname = 'allow_all'
     AND tablename IN ('permissions', 'platform_owner_emails')
  HAVING count(*) = 2;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: the global catalogs permissions/platform_owner_emails lost their allow_all policy';
  END IF;
END $$;
