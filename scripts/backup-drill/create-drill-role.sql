-- One-time setup: the read-only role the weekly backup-restore drill connects as.
--
-- RUN WITH psql, AS THE `postgres` ROLE, NOT IN THE SUPABASE SQL EDITOR. The password is a psql
-- variable so it is never a literal in this file, in shell history (read it with `read -s`), or in
-- the dashboard's saved-query history — and the SQL editor cannot bind psql variables.
--
--   read -rs DRILL_PW                                     (paste a fresh 32+ char random password)
--   psql "$ADMIN_SESSION_POOLER_URL" -v password="$DRILL_PW" -f scripts/backup-drill/create-drill-role.sql
--
-- Idempotent: re-running it rotates the password and re-asserts every attribute below.
--
-- WHY BYPASSRLS — THE ONE DECISION IN THIS FILE THAT NEEDS A HUMAN TO AGREE WITH IT
-- ---------------------------------------------------------------------------------
-- `pg_read_all_data` grants SELECT on every table, but it does NOT bypass row-level security: RLS
-- policies still apply to a member of that role. Every tenant table in `public` has RLS enabled (most
-- with FORCE), and the policies return zero rows when `app.current_org_id` is unset. So a role with
-- only pg_read_all_data would make pg_dump abort ("query would be affected by row-level security
-- policy"), or, with row_security on, silently dump an EMPTY backup that still "verifies" against
-- counts filtered the same way. A backup must contain every row, so the role needs BYPASSRLS.
--
-- That makes this role able to READ every tenant's data, including candidate PII. The trade-off is
-- contained by what it CANNOT do, and every one of these is asserted at the bottom of this file:
--   - no INSERT/UPDATE/DELETE/TRUNCATE on any table (pg_read_all_data is SELECT-only; nothing else
--     is granted), and default_transaction_read_only = on as a second layer;
--   - not a superuser; cannot create roles or databases; no replication;
--   - CONNECTION LIMIT 2 (the snapshot session + pg_dump — the drill never needs more);
--   - statement and idle-in-transaction timeouts, so a hung drill cannot hold a snapshot open.
-- It is exactly as sensitive as the `postgres` password the app already uses (which also has
-- BYPASSRLS), and much less powerful. Its credential lives only in the GitHub secret
-- PROD_BACKUP_DRILL_URL, which is an access-register entry (#40). Rotate it by re-running this file.
--
-- Supabase ships a similar built-in role (`supabase_read_only_user`: BYPASSRLS + pg_read_all_data).
-- It is deliberately NOT reused: it is platform-managed, has no password we control, and revoking
-- or rotating it must not be entangled with a Supabase dashboard feature.

\set ON_ERROR_STOP on

\if :{?password}
\else
  \echo 'ERROR: pass the password as a psql variable: -v password="$DRILL_PW"'
  SELECT 1 / 0 AS missing_password_variable;
\endif

SELECT length(:'password') >= 32 AS password_ok \gset
\if :password_ok
\else
  \echo 'ERROR: the password must be at least 32 characters.'
  SELECT 1 / 0 AS password_too_short;
\endif

BEGIN;

SELECT 'CREATE ROLE backup_drill_reader'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_drill_reader')
\gexec

-- SUPERUSER/REPLICATION are not named here: on Supabase `postgres` is not a superuser and may not
-- mention them at all, even to say NO. New roles default to neither; the assertions below enforce it.
ALTER ROLE backup_drill_reader WITH
  LOGIN NOCREATEDB NOCREATEROLE INHERIT BYPASSRLS
  CONNECTION LIMIT 2
  PASSWORD :'password';

-- INHERIT (above) is required: pg_dump uses the privileges of pg_read_all_data without SET ROLE.
GRANT pg_read_all_data TO backup_drill_reader;

SELECT format('GRANT CONNECT ON DATABASE %I TO backup_drill_reader', current_database())
\gexec

ALTER ROLE backup_drill_reader SET default_transaction_read_only = on;
ALTER ROLE backup_drill_reader SET statement_timeout = '15min';
ALTER ROLE backup_drill_reader SET idle_in_transaction_session_timeout = '30min';

-- ── Assertions: fail (and roll back) unless the role is exactly what the comment above claims ────
DO $$
DECLARE
  r pg_roles%ROWTYPE;
  writable int;
  memberships text;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'backup_drill_reader';
  IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR NOT r.rolbypassrls
     OR NOT r.rolcanlogin OR r.rolconnlimit <> 2 THEN
    RAISE EXCEPTION 'backup_drill_reader has unexpected attributes';
  END IF;

  SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) INTO memberships
  FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
  WHERE m.member = r.oid;
  IF memberships IS DISTINCT FROM 'pg_read_all_data' THEN
    RAISE EXCEPTION 'backup_drill_reader must be a member of pg_read_all_data only, found: %', memberships;
  END IF;

  SELECT count(*) INTO writable
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND (has_table_privilege(r.oid, c.oid, 'INSERT') OR has_table_privilege(r.oid, c.oid, 'UPDATE')
      OR has_table_privilege(r.oid, c.oid, 'DELETE') OR has_table_privilege(r.oid, c.oid, 'TRUNCATE'));
  IF writable > 0 THEN
    RAISE EXCEPTION 'backup_drill_reader can write to % table(s) — refusing', writable;
  END IF;
END
$$;

COMMIT;

\echo 'backup_drill_reader is ready. Build PROD_BACKUP_DRILL_URL from the SESSION pooler (port 5432):'
\echo '  postgresql://backup_drill_reader.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres'
\echo 'Do NOT add sslmode to the URL — the drill enforces verify-full itself.'
