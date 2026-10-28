#!/usr/bin/env bash
#
# Every CREATE [OR REPLACE] FUNCTION / PROCEDURE in the given SQL files pins search_path — decided by
# PostgreSQL itself, not by parsing SQL (#376; Supabase database lint 0011, function_search_path_mutable).
#
# WHY A REAL SERVER
# -----------------
# The first version of this gate stripped bodies and comments with regular expressions. Four review rounds
# each found another SQL shape it mishandled (digits in dollar-quote tags, quoted argument defaults, `--`
# inside a literal, nested comments). Here the SQL is never parsed by us:
#   - psql's own lexer splits each file into statements, exactly as when the owner applies it;
#   - an event trigger fires on ddl_command_start for every CREATE FUNCTION / CREATE PROCEDURE the server
#     actually executes, including ones inside DO blocks and EXECUTE;
#   - on ddl_command_end it reads the new routine's pg_proc.proconfig — the value the lint inspects — right
#     after THAT statement, so a pin added later by ALTER FUNCTION does not count. That is the point: a
#     CREATE OR REPLACE without a SET clause RESETS proconfig, so only a pin carried by the CREATE survives.
# The server logs every statement it receives and every event as JSON (jsonlog), and
# scripts/db/verify-function-search-path-report.mjs attributes events and errors to statements.
#
# FAIL-CLOSED RULES (each is a violation, exit 1)
#   UNPINNED    the routine was created and its proconfig has no search_path entry
#   UNVERIFIED  a routine-creating statement could not be checked: a CREATE FUNCTION/PROCEDURE started but
#               did not complete (a type it needs is missing here); or a routine was created by dynamic SQL
#               inside a DO / SELECT / CALL (only top-level CREATE statements are verifiable: what dynamic
#               code creates depends on database state); or a statement that is not server-tagged as DDL
#               contains the substrings "create" and "function"/"procedure" (a failed, untaken or looping
#               path in a DO block); or a routine's own text mentions creating another; or the file uses a
#               psql meta-command, which is refused (below); or psql exited non-zero.
#               The rules are in scripts/db/verify-function-search-path-report.mjs.
#   SYNTAX      PostgreSQL could not parse a statement (SQLSTATE 42601): a routine inside it would go unseen
# Other errors (a REVOKE on a table the scratch database does not have) are expected and ignored: each
# statement runs under psql ON_ERROR_ROLLBACK, so one failure does not abort the rest of the file.
#
# WHICH FILES ARE APPLIED. Only files whose text contains "function" or "procedure" (any case, anywhere,
# comments included), or — ANYWHERE on a line, since psql accepts `SELECT 1; \ir x.sql` — an include
# (\i, \ir, \include, \include_relative), which pulls in another file's text; includes are then refused by
# \restrict and reported. Every statement that creates a routine names one of the keywords, so this filter
# can only over-include; it exists because
# files that cannot create a routine are often not applicable to an empty database (e.g. a role-provisioning
# script driven by psql variables and \gexec). Building the keyword out of fragments — inside EXECUTE, or in a
# query whose output \gexec runs ('FUNC' || 'TION') — would evade both this filter and the mention count;
# that is not a shape this repository's DDL uses, and review is the control for it.
#
# ISOLATION. Nothing here reads a connection URL or touches an existing database. initdb creates a cluster
# in a temporary directory, listening on a Unix socket in that directory only (listen_addresses=''), with
# SCRAM password authentication and a separate random password per role; it is deleted on exit. Each file
# runs as a NON-superuser in its own scratch database, under psql's \restrict mode, so it cannot run psql
# meta-commands (no \! shell, no \connect to another identity or database, no \o pipe), cannot turn off
# logging (log_min_messages, log_statement) or event triggers (event_triggers, session_replication_role),
# and cannot reach another database (\restrict refuses \connect; CONNECT is also revoked on every other
# database, as a second layer that no test can observe while \restrict holds).
#
# EXIT CODES (cf. .claude/rules/verification.md)
#   0  ran; every routine created by the files pins search_path
#   1  ran; found an UNPINNED / UNVERIFIED / SYNTAX violation
#   2  COULD NOT RUN — no PostgreSQL >= 17 binaries, no node, or the scratch cluster failed. NOT a pass.
#
# USAGE
#   bash scripts/db/verify-function-search-path.sh FILE.sql [FILE.sql ...]
#   SEARCH_PATH_GATE_PG_BIN=/path/to/postgresql/bin   to choose the binaries (needs initdb, pg_ctl, psql)
set -uo pipefail
# A fixed locale: without one the macOS postmaster refuses to start ("became multithreaded during startup").
export LC_ALL=C
unset PGPASSWORD PGUSER PGDATABASE PGHOST PGPORT PGSERVICE PGOPTIONS
export PGPASSFILE=/dev/null

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTER="$HERE/verify-function-search-path-report.mjs"

die2() {
  echo "⚠ SEARCH_PATH GATE DID NOT RUN — $1" >&2
  echo "  This is exit 2, not a pass. Nothing was verified." >&2
  exit 2
}

[ "$#" -gt 0 ] || die2 "no SQL files given."
for f in "$@"; do [ -f "$f" ] || die2 "not a file: $f"; done
command -v node >/dev/null 2>&1 || die2 "node is required for the log reporter."
[ -f "$REPORTER" ] || die2 "reporter not found: $REPORTER"

# Production is PostgreSQL 17, and the SYNTAX rule depends on the grammar: an older server rejects newer
# syntax (GRANT ... WITH INHERIT is 16+). psql's \restrict mode needs 17.6+. So only binaries reporting at
# least 17.6 are accepted, newest first.
find_pg_bin() {
  local c v major minor candidates=()
  [ -n "${SEARCH_PATH_GATE_PG_BIN:-}" ] && candidates+=("$SEARCH_PATH_GATE_PG_BIN")
  for v in 19 18 17; do candidates+=("/opt/homebrew/opt/postgresql@$v/bin" "/usr/local/opt/postgresql@$v/bin" "/usr/lib/postgresql/$v/bin"); done
  if command -v initdb >/dev/null 2>&1; then candidates+=("$(dirname "$(command -v initdb)")"); fi
  for c in "${candidates[@]}"; do
    [ -x "$c/initdb" ] && [ -x "$c/pg_ctl" ] && [ -x "$c/psql" ] || continue
    v="$("$c/psql" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)"
    major="${v%%.*}"; minor="${v#*.}"
    [ -n "$major" ] && [ -n "$minor" ] || continue
    if [ "$major" -gt 17 ] || { [ "$major" -eq 17 ] && [ "$minor" -ge 6 ]; }; then echo "$c"; return 0; fi
  done
  return 1
}

PG_BIN="$(find_pg_bin)" || die2 "no PostgreSQL >= 17.6 server binaries (initdb, pg_ctl, psql) found.
  macOS:  brew install postgresql@17
  Linux:  apt-get install postgresql-17   (PGDG)
  Or set SEARCH_PATH_GATE_PG_BIN=/path/to/bin."

TMP="$(mktemp -d)"
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  "$PG_BIN/pg_ctl" -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

rand() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
NONCE="$(rand)"
ADMIN_PW="$(rand)"
AUTHOR_PW="$(rand)"
RESTRICT_KEY="$(rand)"
[ "${#NONCE}" -eq 32 ] && [ "${#ADMIN_PW}" -eq 32 ] && [ "${#AUTHOR_PW}" -eq 32 ] && [ "${#RESTRICT_KEY}" -eq 32 ] \
  || die2 "could not read random bytes from /dev/urandom."
ADMIN=gate_admin
AUTHOR=gate_author
LOG="$TMP/logs/server.json"

( umask 077; printf '%s\n' "$ADMIN_PW" >"$TMP/pw" )
"$PG_BIN/initdb" -D "$TMP/data" -U "$ADMIN" --auth=scram-sha-256 --pwfile="$TMP/pw" -E UTF8 --no-locale \
  >"$TMP/initdb.log" 2>&1 || die2 "initdb failed:
$(sed 's/^/    /' "$TMP/initdb.log" | tail -15)"
rm -f "$TMP/pw"
"$PG_BIN/pg_ctl" -D "$TMP/data" -w -t 60 -l "$TMP/pg_ctl.log" \
  -o "-c listen_addresses='' -k $TMP -p 5432 -c fsync=off -c logging_collector=on -c log_destination=jsonlog -c log_directory=$TMP/logs -c log_filename=server.log -c log_statement=all -c log_min_messages=warning" \
  start >"$TMP/start.log" 2>&1 \
  || die2 "the scratch cluster did not start:
$(cat "$TMP/start.log" "$TMP/pg_ctl.log" 2>/dev/null | sed 's/^/    /' | tail -15)"

admin_psql() { PGPASSWORD="$ADMIN_PW" "$PG_BIN/psql" -X -q -h "$TMP" -p 5432 -U "$ADMIN" -v ON_ERROR_STOP=1 "$@"; }

# Template: event triggers + the non-superuser that applies the files. RAISE LOG goes to the server log, which
# only a superuser can silence; client_min_messages (settable by anyone) does not affect it.
admin_psql -d postgres >"$TMP/setup.log" 2>&1 <<SQL || die2 "scratch setup failed:
$(sed 's/^/    /' "$TMP/setup.log" | tail -15)"
CREATE ROLE $AUTHOR LOGIN PASSWORD '$AUTHOR_PW' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
CREATE DATABASE gate_template;
REVOKE CONNECT ON DATABASE gate_template FROM PUBLIC;
\connect gate_template
CREATE SCHEMA search_path_gate;
REVOKE ALL ON SCHEMA search_path_gate FROM PUBLIC;
-- The nonce lives in a table only the superuser can read, NOT in the function source: pg_proc.prosrc is
-- world-readable, and a file that learned the nonce could RAISE LOG forged events (tier-1 round 5).
-- Both functions below are SECURITY DEFINER, so their search_path puts pg_temp LAST and their types are
-- schema-qualified: otherwise pg_temp is searched FIRST for types, and a file could shadow `text` with a temp
-- domain whose CHECK would run as the superuser (tier-1 round 6).
CREATE TABLE search_path_gate.secret (nonce text NOT NULL);
REVOKE ALL ON TABLE search_path_gate.secret FROM PUBLIC;
INSERT INTO search_path_gate.secret VALUES ('$NONCE');
CREATE FUNCTION search_path_gate.on_start() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp AS \$f\$
DECLARE n pg_catalog.text;
BEGIN
  SELECT nonce INTO n FROM search_path_gate.secret;
  RAISE LOG 'search-path-gate:%:%:start:%', n, current_database(), tg_tag;
END
\$f\$;
CREATE FUNCTION search_path_gate.on_end() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp AS \$f\$
DECLARE r record; pinned pg_catalog.bool; n pg_catalog.text;
BEGIN
  SELECT nonce INTO n FROM search_path_gate.secret;
  FOR r IN SELECT objid, object_identity FROM pg_event_trigger_ddl_commands()
           WHERE classid = 'pg_proc'::regclass LOOP
    SELECT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search\_path=%')
      INTO pinned FROM pg_proc p WHERE p.oid = r.objid;
    RAISE LOG 'search-path-gate:%:%:end:%:%', n, current_database(),
      CASE WHEN pinned THEN 'pinned' ELSE 'unpinned' END, r.object_identity;
  END LOOP;
END
\$f\$;
-- Every DDL command, not only routine DDL: the reporter needs each statement's server-reported tag.
CREATE EVENT TRIGGER search_path_gate_start ON ddl_command_start
  EXECUTE FUNCTION search_path_gate.on_start();
CREATE EVENT TRIGGER search_path_gate_end ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE') EXECUTE FUNCTION search_path_gate.on_end();
SQL

# wait_for_log MARKER → the logging collector writes asynchronously; a marker logged AFTER a file's session
# ended proves every entry of that session is in the file.
wait_for_log() {
  local _
  for _ in $(seq 1 200); do
    grep -qF -- "$1" "$LOG" 2>/dev/null && return 0
    sleep 0.05
  done
  return 1
}

violations=0
applied=0
i=0
for file in "$@"; do
  if ! grep -qiE 'function|procedure' "$file" \
    && ! grep -qE '\\(i|ir|include|include_relative)([^A-Za-z_]|$)' "$file"; then
    continue
  fi
  applied=$((applied + 1))
  i=$((i + 1))
  db="gate_f$i"
  admin_psql -d postgres -c "CREATE DATABASE $db OWNER $AUTHOR TEMPLATE gate_template" >/dev/null 2>"$TMP/create.err" \
    || die2 "could not create a scratch database for $file:
$(sed 's/^/    /' "$TMP/create.err")"
  admin_psql -d postgres -c "REVOKE CONNECT ON DATABASE $db FROM PUBLIC" >/dev/null 2>&1 \
    || die2 "could not restrict the scratch database for $file."

  # check_function_bodies=off: a SQL-language body may name tables this empty database does not have; what is
  # checked is the routine's options, which do not depend on its body. \restrict comes first, so none of the
  # file's own meta-commands run.
  PGPASSWORD="$AUTHOR_PW" PGOPTIONS="-c check_function_bodies=off" "$PG_BIN/psql" -X -q -h "$TMP" -p 5432 \
    -U "$AUTHOR" -d "$db" -v ON_ERROR_ROLLBACK=on -c "\\restrict $RESTRICT_KEY" -f "$file" >"$TMP/out.$i" 2>"$TMP/err.$i"
  rc=$?
  admin_psql -d postgres -c "DROP DATABASE $db WITH (FORCE)" >/dev/null 2>&1 || true
  flush="search-path-gate:$NONCE:flush:$db"
  if ! admin_psql -d postgres -c "DO \$\$ BEGIN RAISE LOG '$flush'; END \$\$" >/dev/null 2>&1 \
    || ! wait_for_log "$flush"; then
    die2 "the server log did not record the end of $file."
  fi

  node "$REPORTER" "$LOG" "$NONCE" "$db" "$file"
  case $? in
    0) ;;
    1) violations=$((violations + 1)) ;;
    *) die2 "the log reporter failed for $file." ;;
  esac
  if grep -q 'backslash commands are restricted' "$TMP/err.$i"; then
    printf '%s\n' "UNVERIFIED $file: psql meta-commands are not executed by this gate (restrict mode), so what they would do is unchecked:"
    grep 'backslash commands are restricted' "$TMP/err.$i" | sed 's/^/             /' | head -5
    violations=$((violations + 1))
  fi
  if [ "$rc" -ne 0 ]; then
    echo "UNVERIFIED $file: psql exited $rc, so the file was not applied to the end:"
    sed 's/^/             /' "$TMP/err.$i" | tail -5
    violations=$((violations + 1))
  fi
done

if [ "$violations" -gt 0 ]; then
  echo "✖ search_path gate: violations in $violations of $applied applied file(s) ($# given)." >&2
  echo "  Add \`SET search_path = ''\` (or an explicit schema list) to the CREATE statement itself: a CREATE OR" >&2
  echo "  REPLACE without it RESETS any pin applied earlier by ALTER FUNCTION (Supabase lint 0011)." >&2
  exit 1
fi
echo "✓ search_path gate: every routine created by $applied of $# file(s) is pinned (the rest never mention FUNCTION/PROCEDURE); PostgreSQL $("$PG_BIN/psql" --version | grep -oE '[0-9]+\.[0-9]+' | head -1)."
exit 0
