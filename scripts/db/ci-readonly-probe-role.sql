-- ci-readonly-probe-role.sql — least-privilege RLS probe for the nightly DB controls (PR #292).
--
-- RUN BY THE OWNER, NEVER BY CI OR AN AGENT:
--   psql "<postgres-role direct URL, sslmode=verify-full>" -v ON_ERROR_STOP=1 -f scripts/db/ci-readonly-probe-role.sql
-- Idempotent: safe to re-run. One transaction: any failed assertion rolls the whole thing back.
--
-- THE PROBLEM
--   Check 14's empirical probe issued SET LOCAL ROLE app_tenant, which requires MEMBERSHIP in app_tenant.
--   So ci_readonly — the credential behind the PROD_DIRECT_URL GitHub secret — was granted app_tenant, and
--   app_tenant holds SELECT/INSERT/UPDATE/DELETE on the tenant tables. NOINHERIT stops ci_readonly from
--   holding those privileges passively, but not from assuming them: `SET ROLE app_tenant; DELETE ...` was
--   one statement away for anyone holding the secret. "Read-only" was not true.
--
-- THE DESIGN (option a: a SELECT-only probe role — chosen because it needs NO policy change)
--   Every public-schema policy in production is created without a TO clause, i.e. TO public
--   (packages/db/baseline/prod-public-schema.sql: all 102 CREATE POLICY statements). A policy TO public
--   binds every role, so a NOBYPASSRLS role with SELECT is filtered by exactly the same tenant_isolation
--   predicate as app_tenant. Probing as ci_rls_probe therefore proves the same fail-closed property.
--   Option b — adding ci_rls_probe to each policy's role list — would only be needed if policies were
--   scoped TO app_tenant; they are not, and editing 100 production policies to serve a CI check is the
--   more invasive change. Check 14 now asserts the TO-public invariant every night (finding
--   `policy-role-scope`), so if a future policy narrows its roles the equivalence is flagged, not assumed.
--
--   SELECT ON ALL TABLES adds no read capability: ci_readonly already holds SELECT on every public table,
--   and ci_rls_probe is NOLOGIN, reachable only via SET ROLE from ci_readonly.
--
-- Check 17 no longer needs app_tenant membership either: it reads grants from pg_class.relacl.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_readonly') THEN
    RAISE EXCEPTION 'role ci_readonly does not exist — wrong database, or provision it first (see nightly-db-controls.yml header)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_rls_probe') THEN
    CREATE ROLE ci_rls_probe NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Re-assert attributes every run, so a hand-edited role is brought back to spec.
ALTER ROLE ci_rls_probe NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Reset, then grant exactly: USAGE on public, SELECT on its tables, and SELECT on future tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ci_rls_probe;
GRANT USAGE ON SCHEMA public TO ci_rls_probe;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ci_rls_probe;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO ci_rls_probe;

-- ci_readonly may ASSUME the probe role (SET ROLE) but does not inherit it. PostgreSQL 16+ syntax;
-- production is 17.x.
GRANT ci_rls_probe TO ci_readonly WITH INHERIT FALSE, SET TRUE;

-- Remove every app_tenant membership ci_readonly holds, whoever granted it. A plain REVOKE only removes
-- the grant made by the current role and merely WARNS about others — the assertion below would then fail.
DO $$
DECLARE
  g record;
BEGIN
  FOR g IN
    SELECT gr.rolname AS grantor
      FROM pg_auth_members m
      JOIN pg_roles r  ON r.oid  = m.roleid AND r.rolname = 'app_tenant'
      JOIN pg_roles mb ON mb.oid = m.member AND mb.rolname = 'ci_readonly'
      JOIN pg_roles gr ON gr.oid = m.grantor
  LOOP
    EXECUTE format('REVOKE app_tenant FROM ci_readonly GRANTED BY %I', g.grantor);
  END LOOP;
END
$$;

-- ── Assertions: any failure raises, and ON_ERROR_STOP + the open transaction roll everything back ──
DO $$
DECLARE
  bad text;
BEGIN
  IF pg_has_role('ci_readonly', 'app_tenant', 'MEMBER') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ci_readonly can still reach app_tenant (directly or via another role)';
  END IF;

  IF NOT pg_has_role('ci_readonly', 'ci_rls_probe', 'SET') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ci_readonly cannot SET ROLE ci_rls_probe — check 14 would exit 2';
  END IF;

  IF (SELECT rolbypassrls OR rolsuper OR rolcanlogin FROM pg_roles WHERE rolname = 'ci_rls_probe') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ci_rls_probe must be NOLOGIN, NOSUPERUSER, NOBYPASSRLS';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'ci_rls_probe') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ci_rls_probe is a member of another role and could inherit its privileges';
  END IF;

  -- No write-class privilege on any relation in any schema, by direct grant.
  SELECT string_agg(DISTINCT format('%I.%I:%s', n.nspname, c.relname, a.privilege_type), ', ')
    INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE a.grantee = 'ci_rls_probe'::regrole
     AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ci_rls_probe holds write privileges: %', bad;
  END IF;

  -- And effectively, in public (includes anything reachable through PUBLIC grants).
  SELECT string_agg(format('%I', c.relname), ', ')
    INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (has_table_privilege('ci_rls_probe', c.oid, 'INSERT')
       OR has_table_privilege('ci_rls_probe', c.oid, 'UPDATE')
       OR has_table_privilege('ci_rls_probe', c.oid, 'DELETE')
       OR has_table_privilege('ci_rls_probe', c.oid, 'TRUNCATE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ci_rls_probe can effectively write public tables: %', bad;
  END IF;

  RAISE NOTICE 'OK: ci_rls_probe is SELECT-only and assumable by ci_readonly; ci_readonly is no longer a member of app_tenant.';
END
$$;

COMMIT;

-- Post-commit read-back (informational; the DO block above is the gate):
SELECT r.rolname,
       r.rolcanlogin, r.rolinherit, r.rolbypassrls,
       pg_has_role('ci_readonly', 'app_tenant',   'MEMBER') AS ci_readonly_reaches_app_tenant,
       pg_has_role('ci_readonly', 'ci_rls_probe', 'SET')    AS ci_readonly_can_set_probe
  FROM pg_roles r
 WHERE r.rolname IN ('ci_readonly', 'ci_rls_probe')
 ORDER BY r.rolname;
