#!/usr/bin/env bash
#
# Every CREATE [OR REPLACE] FUNCTION / PROCEDURE in the given SQL files pins search_path — decided by
# PostgreSQL itself, not by parsing SQL (#376; Supabase database lint 0011, function_search_path_mutable).
#
# WHY A REAL SERVER
# -----------------
# The first version of this gate stripped bodies and comments with regular expressions. Four review rounds
# each found another SQL shape it mishandled (digits in dollar-quote tags, quoted argument defaults, `--`
# inside a literal, nested comments). Here nothing is parsed by us:
#   - psql's own lexer splits each file into statements, exactly as when the owner applies it;
#   - an event trigger fires on ddl_command_start for every CREATE FUNCTION / CREATE PROCEDURE the server
#     actually executes, including ones inside DO blocks and EXECUTE;
#   - on ddl_command_end it reads the new routine's pg_proc.proconfig — the value the lint inspects — right
#     after THAT statement, so a pin added later by ALTER FUNCTION does not count. That is the point: a
#     CREATE OR REPLACE without a SET clause RESETS proconfig, so only a pin carried by the CREATE survives.
#
# FAIL-CLOSED RULES (each is a violation, exit 1)
#   UNPINNED    the routine was created and its proconfig has no search_path entry
#   UNVERIFIED  a CREATE FUNCTION/PROCEDURE started but did not complete (e.g. a type it needs does not exist
#               in the empty scratch database), so its pin could not be read — or psql aborted the file
#   SYNTAX      PostgreSQL could not parse a statement (SQLSTATE 42601). A routine inside an unparseable
#               statement never reaches the event trigger, so a syntax error anywhere fails the gate.
# Other errors (a REVOKE on a table the scratch database does not have) are expected and ignored: each
# statement runs under psql ON_ERROR_ROLLBACK, so one failure does not abort the rest of the file.
#
# WHICH FILES ARE APPLIED. Only files whose text contains "function" or "procedure" (any case, anywhere,
# comments included) or a psql include (\i, \ir, \include, \include_relative). Every statement that
# creates a routine names one of those keywords, so this filter can only over-include; it exists because
# files that cannot create a routine are often not applicable to an empty database (a file that sets its
# own ON_ERROR_STOP and asserts on production state stops early, which this gate must otherwise report as
# UNVERIFIED). Building the statement out of fragments inside EXECUTE ('FUNC' || 'TION') would evade it; that
# is not a shape this repository's DDL uses, and review is the control for it.
#
# ISOLATION. Nothing here reads a connection URL or touches any existing database. It runs initdb into a
# temporary directory, listens on a Unix socket in that directory only (listen_addresses=''), and deletes the
# cluster on exit. Files run as a NON-superuser that owns only its own scratch database, so a file cannot
# turn off logging (log_min_messages), event triggers (event_triggers, session_replication_role) or switch
# to another database (CONNECT is revoked on every other one).
#
# EXIT CODES (cf. .claude/rules/verification.md)
#   0  ran; every routine created by the files pins search_path
#   1  ran; found an UNPINNED / UNVERIFIED / SYNTAX violation
#   2  COULD NOT RUN — no PostgreSQL server binaries, or the scratch cluster failed. NOT a pass.
#
# USAGE
#   bash scripts/db/verify-function-search-path.sh FILE.sql [FILE.sql ...]
#   SEARCH_PATH_GATE_PG_BIN=/path/to/postgresql/bin   to choose the binaries (needs initdb, pg_ctl, psql)
set -uo pipefail
# A fixed locale: without one the macOS postmaster refuses to start ("became multithreaded during startup").
export LC_ALL=C

die2() {
  echo "⚠ SEARCH_PATH GATE DID NOT RUN — $1" >&2
  echo "  This is exit 2, not a pass. Nothing was verified." >&2
  exit 2
}

[ "$#" -gt 0 ] || die2 "no SQL files given."
for f in "$@"; do [ -f "$f" ] || die2 "not a file: $f"; done

# Production is PostgreSQL 17, and the SYNTAX rule depends on the grammar: an older server rejects newer
# syntax (GRANT ... WITH INHERIT is 16+). So only a server of at least this major is accepted, newest first.
MIN_MAJOR=17
find_pg_bin() {
  local c v candidates=()
  [ -n "${SEARCH_PATH_GATE_PG_BIN:-}" ] && candidates+=("$SEARCH_PATH_GATE_PG_BIN")
  for v in 19 18 17; do candidates+=("/opt/homebrew/opt/postgresql@$v/bin" "/usr/local/opt/postgresql@$v/bin" "/usr/lib/postgresql/$v/bin"); done
  if command -v initdb >/dev/null 2>&1; then candidates+=("$(dirname "$(command -v initdb)")"); fi
  for c in "${candidates[@]}"; do
    [ -x "$c/initdb" ] && [ -x "$c/pg_ctl" ] && [ -x "$c/psql" ] || continue
    v="$("$c/initdb" --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"
    if [ -n "$v" ] && [ "$v" -ge "$MIN_MAJOR" ]; then echo "$c"; return 0; fi
  done
  return 1
}

PG_BIN="$(find_pg_bin)" || die2 "no PostgreSQL >= $MIN_MAJOR server binaries (initdb, pg_ctl, psql) found.
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

NONCE="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
[ -n "$NONCE" ] || die2 "could not read a nonce from /dev/urandom."
ADMIN=gate_admin
AUTHOR=gate_author

"$PG_BIN/initdb" -D "$TMP/data" -U "$ADMIN" --auth=trust -E UTF8 --no-locale >"$TMP/initdb.log" 2>&1 \
  || die2 "initdb failed:
$(sed 's/^/    /' "$TMP/initdb.log" | tail -15)"
"$PG_BIN/pg_ctl" -D "$TMP/data" -w -t 60 -l "$TMP/server.log" \
  -o "-c listen_addresses='' -k $TMP -p 5432 -c fsync=off -c log_min_messages=warning -c log_min_error_statement=panic" \
  start >"$TMP/pg_ctl.log" 2>&1 \
  || die2 "the scratch cluster did not start:
$(sed 's/^/    /' "$TMP/server.log" 2>/dev/null | tail -15)"

admin_psql() { "$PG_BIN/psql" -X -q -h "$TMP" -p 5432 -U "$ADMIN" -v ON_ERROR_STOP=1 "$@"; }

# Template: event triggers + the non-superuser that applies the files. RAISE LOG goes to the server log, which
# only a superuser can silence; client_min_messages (settable by anyone) does not affect it.
admin_psql -d postgres >"$TMP/setup.log" 2>&1 <<SQL || die2 "scratch setup failed:
$(sed 's/^/    /' "$TMP/setup.log" | tail -15)"
CREATE ROLE $AUTHOR LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
CREATE DATABASE gate_template;
REVOKE CONNECT ON DATABASE gate_template FROM PUBLIC;
\connect gate_template
CREATE SCHEMA search_path_gate;
REVOKE ALL ON SCHEMA search_path_gate FROM PUBLIC;
CREATE FUNCTION search_path_gate.on_start() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog AS \$f\$
BEGIN
  RAISE LOG 'search-path-gate:$NONCE:%:start:%', current_database(), tg_tag;
END
\$f\$;
CREATE FUNCTION search_path_gate.on_end() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog AS \$f\$
DECLARE r record; pinned boolean;
BEGIN
  FOR r IN SELECT objid, object_identity FROM pg_event_trigger_ddl_commands()
           WHERE classid = 'pg_proc'::regclass LOOP
    SELECT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search\_path=%')
      INTO pinned FROM pg_proc p WHERE p.oid = r.objid;
    RAISE LOG 'search-path-gate:$NONCE:%:end:%:%', current_database(),
      CASE WHEN pinned THEN 'pinned' ELSE 'unpinned' END, r.object_identity;
  END LOOP;
END
\$f\$;
CREATE EVENT TRIGGER search_path_gate_start ON ddl_command_start
  WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE') EXECUTE FUNCTION search_path_gate.on_start();
CREATE EVENT TRIGGER search_path_gate_end ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE') EXECUTE FUNCTION search_path_gate.on_end();
SQL

violations=0
routines=0
applied=0
i=0
for file in "$@"; do
  if ! grep -qiE 'function|procedure' "$file" \
    && ! grep -qE '^[[:space:]]*\\(i|ir|include|include_relative)([[:space:]]|$)' "$file"; then
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
  # checked is the routine's options, which do not depend on its body.
  PGOPTIONS="-c check_function_bodies=off" "$PG_BIN/psql" -X -q -h "$TMP" -p 5432 -U "$AUTHOR" -d "$db" \
    -v ON_ERROR_ROLLBACK=on -v VERBOSITY=verbose -f "$file" >"$TMP/out.$i" 2>"$TMP/err.$i"
  rc=$?
  admin_psql -d postgres -c "DROP DATABASE $db WITH (FORCE)" >/dev/null 2>&1 || true

  marker="search-path-gate:$NONCE:$db:"
  starts="$(grep -c "${marker}start:" "$TMP/server.log" || true)"
  ends="$(grep "${marker}end:" "$TMP/server.log" | sed "s/.*${marker}end://" || true)"
  nends="$(printf '%s\n' "$ends" | grep -c . || true)"
  routines=$((routines + nends))

  while IFS= read -r e; do
    [ -n "$e" ] || continue
    state="${e%%:*}"; ident="${e#*:}"
    if [ "$state" = "pinned" ]; then
      echo "PINNED     $file: $ident"
    else
      echo "UNPINNED   $file: $ident"
      violations=$((violations + 1))
    fi
  done <<<"$ends"

  if [ "$starts" -gt "$nends" ]; then
    echo "UNVERIFIED $file: $((starts - nends)) CREATE FUNCTION/PROCEDURE statement(s) did not complete, so their search_path could not be read:"
    grep -E '^psql:.*ERROR:' "$TMP/err.$i" | sed 's/^/             /' | head -10
    violations=$((violations + 1))
  fi
  if grep -qE 'ERROR:  42601' "$TMP/err.$i"; then
    echo "SYNTAX     $file: PostgreSQL could not parse a statement (a routine inside it would go unchecked):"
    grep -E 'ERROR:  42601' "$TMP/err.$i" | sed 's/^/             /' | head -5
    violations=$((violations + 1))
  fi
  if [ "$rc" -ne 0 ]; then
    echo "UNVERIFIED $file: psql exited $rc, so the file was not applied to the end:"
    sed 's/^/             /' "$TMP/err.$i" | tail -5
    violations=$((violations + 1))
  fi
done

if [ "$violations" -gt 0 ]; then
  echo "✖ search_path gate: $violations violation(s); $applied of $# file(s) applied, $routines routine(s) created." >&2
  echo "  Add \`SET search_path = ''\` (or an explicit schema list) to the CREATE statement itself: a CREATE OR" >&2
  echo "  REPLACE without it RESETS any pin applied earlier by ALTER FUNCTION (Supabase lint 0011)." >&2
  exit 1
fi
echo "✓ search_path gate: $routines routine(s) created by $applied of $# file(s) (the rest never mention FUNCTION/PROCEDURE), all pinned (PostgreSQL $("$PG_BIN/psql" --version | grep -oE '[0-9]+(\.[0-9]+)?' | head -1))."
exit 0
