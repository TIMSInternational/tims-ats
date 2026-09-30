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
-- WHAT IT CAN READ — SCOPED TO THE TWO DUMPED SCHEMAS, WHEN SUPABASE ALLOWS IT
-- ------------------------------------------------------------------------------
-- The drill dumps `public` and `auth` only, so the role is granted SELECT on the tables and sequences
-- of those two schemas and nothing else — not vault, cron, net, storage, realtime… (an earlier version
-- granted `pg_read_all_data`, which covers every schema; re-running this file revokes it).
--   - public: `postgres` owns these tables, so it grants SELECT on all of them, plus DEFAULT
--     PRIVILEGES so tables `postgres` creates later (Prisma / flip DDL) are readable too. A table some
--     OTHER role creates in public is not covered: the drill then fails LOUDLY with exit 2
--     (permission denied while counting), and re-running this file fixes it.
--   - auth: tables are owned by supabase_auth_admin, and `postgres` can grant SELECT on them only if
--     it holds the grant option. In supabase/postgres:17.6.1.178 it does NOT (GRANT merely warns "no
--     privileges were granted"), and hosted projects are expected to match. Then this file STOPS,
--     unless you re-run it with `-v allow_read_all_data=1`, which falls back to `pg_read_all_data` —
--     SELECT on EVERY schema, including vault. That broader grant is a human decision, so it is an
--     explicit opt-in and it is recorded in the access register (#40), never a silent fallback. The
--     alternative that keeps the scoping is to ask Supabase support to grant SELECT on auth.* to this
--     role (or the grant option to postgres), then re-run WITHOUT the flag.
-- Dropping the role later needs `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE
-- SELECT ON TABLES, SEQUENCES FROM backup_drill_reader` (or DROP OWNED BY) first.
--
-- WHY BYPASSRLS — THE DECISION IN THIS FILE THAT NEEDS A HUMAN TO AGREE WITH IT
-- ---------------------------------------------------------------------------
-- A SELECT grant (scoped or `pg_read_all_data`) does NOT bypass row-level security: RLS policies still
-- apply to the grantee. Every tenant table in `public` has RLS enabled (most
-- with FORCE), and the policies return zero rows when `app.current_org_id` is unset. So a role with
-- only SELECT grants would make pg_dump abort ("query would be affected by row-level security
-- policy"), or, with row_security on, silently dump an EMPTY backup that still "verifies" against
-- counts filtered the same way. A backup must contain every row, so the role needs BYPASSRLS.
--
-- That makes this role able to READ every tenant's data, including candidate PII. The trade-off is
-- contained by what it CANNOT do, and every one of these is asserted at the bottom of this file:
--   - no INSERT/UPDATE/DELETE/TRUNCATE on any table (only SELECT is granted), and
--     default_transaction_read_only = on as a second layer;
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
\if :{?allow_read_all_data}
\else
  \set allow_read_all_data 0
\endif

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

-- Clean slate for the read grants: an earlier version of this file granted pg_read_all_data.
SELECT 'REVOKE pg_read_all_data FROM backup_drill_reader'
WHERE EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'backup_drill_reader'::regrole
                AND m.roleid = 'pg_read_all_data'::regrole)
\gexec

-- public: USAGE comes from PUBLIC on a Supabase project (asserted below); SELECT is granted here.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_drill_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_drill_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO backup_drill_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_drill_reader;

-- auth: only if postgres can actually grant it (see the header). GRANT does not fail when it cannot —
-- it only warns — so this is checked up front, and the assertions below re-check the outcome.
SELECT has_schema_privilege('auth', 'USAGE WITH GRANT OPTION')
   AND NOT EXISTS (
     SELECT 1 FROM pg_class c
     WHERE c.relnamespace = 'auth'::regnamespace AND c.relkind IN ('r', 'p', 'S')
       AND NOT has_table_privilege(c.oid, 'SELECT WITH GRANT OPTION')
   ) AS auth_grantable \gset
\if :auth_grantable
  GRANT USAGE ON SCHEMA auth TO backup_drill_reader;
  GRANT SELECT ON ALL TABLES IN SCHEMA auth TO backup_drill_reader;
  GRANT SELECT ON ALL SEQUENCES IN SCHEMA auth TO backup_drill_reader;
\elif :allow_read_all_data
  \echo 'NOTICE: postgres cannot grant SELECT on auth.*. Falling back to pg_read_all_data (SELECT on EVERY schema) because -v allow_read_all_data=1 was passed. Record this in the access register (#40).'
  -- INHERIT (above) is required: pg_dump uses the role's privileges without SET ROLE.
  GRANT pg_read_all_data TO backup_drill_reader;
\else
  \echo 'ERROR: postgres cannot grant SELECT on the auth schema (no grant option), so the drill could not read auth.'
  \echo '       Either ask Supabase support to grant SELECT on auth.* to backup_drill_reader, or accept the broader'
  \echo '       pg_read_all_data grant by re-running with -v allow_read_all_data=1. Nothing was committed.'
  SELECT 1 / 0 AS auth_not_grantable;
\endif
SELECT set_config('backup_drill.read_all_expected', (NOT :'auth_grantable'::boolean)::text, true) AS read_all_expected;

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
  unreadable int;
  memberships text;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'backup_drill_reader';
  IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR NOT r.rolbypassrls
     OR NOT r.rolcanlogin OR r.rolconnlimit <> 2 THEN
    RAISE EXCEPTION 'backup_drill_reader has unexpected attributes';
  END IF;

  -- No role memberships at all — except pg_read_all_data, and only on the explicit fallback path.
  SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) INTO memberships
  FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
  WHERE m.member = r.oid;
  -- (Parenthesised: PL/pgSQL would otherwise end the IF condition at the CASE's own THEN.)
  IF memberships IS DISTINCT FROM
     (CASE WHEN current_setting('backup_drill.read_all_expected') = 'true' THEN 'pg_read_all_data' END) THEN
    RAISE EXCEPTION 'backup_drill_reader has unexpected role memberships: %', coalesce(memberships, '(none)');
  END IF;

  -- It must be able to read EVERY table and sequence pg_dump will dump (extension-owned objects are
  -- not dumped). A gap here is the silent-WARNING GRANT case above, caught before the drill hits it.
  SELECT count(*) INTO unreadable
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth') AND c.relkind IN ('r', 'p', 'S')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    AND NOT (has_schema_privilege(r.oid, n.oid, 'USAGE') AND has_table_privilege(r.oid, c.oid, 'SELECT'));
  IF unreadable > 0 THEN
    RAISE EXCEPTION 'backup_drill_reader cannot read % table(s)/sequence(s) in public/auth — the drill would fail', unreadable;
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
