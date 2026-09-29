#!/usr/bin/env bash
#
# Production backup-restore drill.
#
# WHAT THIS PROVES
# ----------------
# That a logical dump of production can be taken, restored into an empty Postgres of the same major
# version, and that the restored copy is COMPLETE: every table's exact row count matches the source
# at one consistent snapshot, and the schema inventory (relations, columns, indexes, constraints, RLS
# flags, policies, triggers, functions) of every dumped schema is identical.
#
# It does NOT prove Supabase's managed daily backups / PITR work — that is a separate, manual,
# quarterly step. See docs/runbooks/backup-restore.md.
#
# EXIT CODES — the did-not-run/found-nothing distinction is the point (.claude/rules/verification.md)
#   0  VERIFIED — dump taken, restored, counts and inventory match
#   1  RAN and FOUND A PROBLEM — restore errors outside the allow-list, a row-count mismatch, or an
#      inventory mismatch. The backup is not trustworthy.
#   2  COULD NOT RUN — missing configuration, unreachable database, wrong client version, a source
#      role that cannot see every row, a target that is not a fresh drill database, a failed dump.
#      Exit 2 is NOT a pass. Nothing was verified.
#
# INPUTS (environment)
#   DRILL_SOURCE_URL       required. Read-only role with BYPASSRLS (create-drill-role.sql). No sslmode
#                          in the URL — TLS is set by DRILL_SOURCE_SSLMODE so it cannot silently degrade.
#   DRILL_TARGET_URL       required. SUPERUSER on a fresh, EPHEMERAL Postgres on a loopback host. The
#                          drill drops and recreates non-public schemas there.
#   DRILL_SOURCE_SSLMODE   default verify-full. Local tests only: disable.
#   DRILL_SOURCE_SSLROOTCERT  default scripts/parity/supabase-root-ca.pem (Supabase Root 2021 CA).
#   DRILL_SCHEMAS          default "public auth". See the runbook for why storage/vault are excluded.
#   DRILL_MIN_TABLES       default 1. The source must expose at least this many tables, so a drill
#                          pointed at an empty or wrong database cannot pass vacuously.
#   DRILL_PG_BIN           optional directory holding pg_dump/pg_restore/psql (major >= 17).
#   DRILL_TEST_POST_RESTORE_SQL  TEST ONLY. SQL run against the TARGET after restore, to prove that a
#                          damaged restore is detected (exit 1). The workflow never sets it.
#   GITHUB_STEP_SUMMARY    optional. When set, the aggregate report is appended there.
#
# PII: production rows exist only in the dump file inside a private temp dir (umask 077) and in the
# ephemeral target. Neither is ever printed or uploaded; the temp dir is deleted by an EXIT trap.
# Only table names, row COUNTS, sizes and timings are reported. Restore error text is redacted
# before printing because Postgres error DETAIL lines can quote row values.
#
# Deliberately NOT `set -e`: every failure below is classified explicitly as exit 1 or exit 2.
set -uo pipefail
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

WORKDIR=""
PSQL_PID=""

cleanup() {
  exec 3>&- 2>/dev/null
  if [ -n "$PSQL_PID" ]; then kill "$PSQL_PID" 2>/dev/null; wait "$PSQL_PID" 2>/dev/null; fi
  # The dump holds production PII. It must not outlive this process on any path.
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then rm -rf "$WORKDIR"; fi
}
trap cleanup EXIT
trap 'echo "interrupted" >&2; exit 2' INT TERM

log() { echo "[drill] $*"; }

die2() {
  echo "⚠ BACKUP-RESTORE DRILL DID NOT RUN — $1" >&2
  echo "  This is exit 2, not a pass. Nothing was verified." >&2
  summary "### ⚠️ Backup-restore drill DID NOT RUN" "" "$1" "" "_Exit 2 is not a pass. Nothing was verified._"
  exit 2
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"
  fi
}

now() { date +%s; }

# ── Configuration ─────────────────────────────────────────────────────────────────────────────────
SOURCE_URL="${DRILL_SOURCE_URL:-}"
TARGET_URL="${DRILL_TARGET_URL:-}"
SSLMODE="${DRILL_SOURCE_SSLMODE:-verify-full}"
SSLROOTCERT="${DRILL_SOURCE_SSLROOTCERT:-$REPO_ROOT/scripts/parity/supabase-root-ca.pem}"
SCHEMAS="${DRILL_SCHEMAS:-public auth}"
MIN_TABLES="${DRILL_MIN_TABLES:-1}"

[ -n "$SOURCE_URL" ] || die2 "DRILL_SOURCE_URL is not set (workflow secret PROD_BACKUP_DRILL_URL)."
[ -n "$TARGET_URL" ] || die2 "DRILL_TARGET_URL is not set."

case "$SOURCE_URL" in
  postgres://*|postgresql://*) ;;
  *) die2 "DRILL_SOURCE_URL must be a postgres:// or postgresql:// URL." ;;
esac
case "$SOURCE_URL" in
  *sslmode=*|*sslrootcert=*)
    die2 "DRILL_SOURCE_URL must not carry sslmode/sslrootcert — set DRILL_SOURCE_SSLMODE instead, so TLS verification cannot be downgraded by the secret's contents." ;;
esac
case "$SSLMODE" in
  verify-full) [ -r "$SSLROOTCERT" ] || die2 "sslmode=verify-full needs a readable root CA at $SSLROOTCERT." ;;
  disable|require|verify-ca) ;;
  *) die2 "DRILL_SOURCE_SSLMODE='$SSLMODE' is not a recognised sslmode." ;;
esac
case "$MIN_TABLES" in ''|*[!0-9]*) die2 "DRILL_MIN_TABLES must be a non-negative integer." ;; esac

SCHEMA_ARRAY=""
SCHEMA_FLAGS=()
for s in $SCHEMAS; do
  # Identifiers are interpolated into SQL below, so accept only plain lower-case names.
  printf '%s' "$s" | grep -Eq '^[a-z_][a-z0-9_]*$' || die2 "invalid schema name in DRILL_SCHEMAS: $s"
  SCHEMA_ARRAY="${SCHEMA_ARRAY:+$SCHEMA_ARRAY,}'$s'"
  SCHEMA_FLAGS+=(-n "$s")
done
[ -n "$SCHEMA_ARRAY" ] || die2 "DRILL_SCHEMAS is empty."
SCHEMA_ARRAY="ARRAY[$SCHEMA_ARRAY]::text[]"

# The source URL with TLS parameters appended.
if [ "$SSLMODE" = "verify-full" ] || [ "$SSLMODE" = "verify-ca" ]; then
  TLS_PARAMS="sslmode=$SSLMODE&sslrootcert=$SSLROOTCERT"
else
  TLS_PARAMS="sslmode=$SSLMODE"
fi
case "$SOURCE_URL" in
  *\?*) SRC="$SOURCE_URL&$TLS_PARAMS" ;;
  *) SRC="$SOURCE_URL?$TLS_PARAMS" ;;
esac

# The target is DESTRUCTIVELY prepared (non-public schemas dropped), so it must be local. This is the
# first of two guards against ever pointing it at production; the second is the empty-public check.
TARGET_HOST="$(printf '%s' "$TARGET_URL" | sed -E 's#^[a-z]+://([^@/]*@)?(\[[^]]*\]|[^:/?]*).*#\2#')"
case "$TARGET_HOST" in
  localhost|127.0.0.1|'[::1]') ;;
  *) die2 "DRILL_TARGET_URL host '$TARGET_HOST' is not loopback. The drill only restores into an ephemeral local database." ;;
esac

# ── Client binaries: major version must be >= the server's ──────────────────────────────────────
find_bin() {
  local name="$1" c ver major
  local candidates=()
  [ -n "${DRILL_PG_BIN:-}" ] && candidates+=("$DRILL_PG_BIN/$name")
  candidates+=("/usr/lib/postgresql/17/bin/$name" "/opt/homebrew/opt/postgresql@17/bin/$name" "$name")
  for c in "${candidates[@]}"; do
    command -v "$c" >/dev/null 2>&1 || continue
    ver="$("$c" --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)"
    major="${ver%%.*}"
    if [ -n "$major" ] && [ "$major" -ge 17 ] 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  return 1
}
PG_DUMP="$(find_bin pg_dump)" || die2 "no pg_dump >= 17 found (set DRILL_PG_BIN)."
PG_RESTORE="$(find_bin pg_restore)" || die2 "no pg_restore >= 17 found (set DRILL_PG_BIN)."
PSQL="$(find_bin psql)" || die2 "no psql >= 17 found (set DRILL_PG_BIN)."
CLIENT_MAJOR="$("$PG_DUMP" --version | grep -oE '[0-9]+' | head -1)"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/backup-drill.XXXXXX")" || die2 "could not create a private work dir."
DUMP="$WORKDIR/drill.dump"

# One-shot query helpers. -X ignores ~/.psqlrc so a developer's settings cannot change the output.
q_src() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -d "$SRC" -c "$1"; }
q_tgt() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -d "$TARGET_URL" -c "$1"; }

# ── The SQL the comparison rests on. Run identically against source (in the snapshot) and target. ─
# Exact counts of every ordinary table in the dumped schemas, excluding extension-owned tables
# (pg_dump does not dump those). `FROM ONLY` counts each row exactly once, even under inheritance or
# partitioning — partitions are ordinary tables and are counted individually.
COUNT_SQL="SELECT 'COUNT' || E'\t' || n.nspname || '.' || c.relname || E'\t' ||
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM ONLY %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = ANY($SCHEMA_ARRAY)
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
ORDER BY 1;"

INVENTORY_SQL="WITH s AS (SELECT oid, nspname FROM pg_namespace WHERE nspname = ANY($SCHEMA_ARRAY)),
t AS (
  SELECT c.oid, s.nspname || '.' || c.relname AS tn, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN s ON s.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
)
SELECT 'INV' || E'\t' || regexp_replace(line, '\s+', ' ', 'g') FROM (
  SELECT 'RELATION ' || tn || ' kind=' || relkind::text || ' rls=' || relrowsecurity || ' force_rls=' || relforcerowsecurity AS line FROM t
  UNION ALL
  SELECT 'COLUMN ' || t.tn || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
         || coalesce(' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid), '')
  FROM t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  UNION ALL
  SELECT 'INDEX ' || t.tn || ' ' || pg_get_indexdef(i.indexrelid) FROM t JOIN pg_index i ON i.indrelid = t.oid
  UNION ALL
  SELECT 'CONSTRAINT ' || t.tn || ' ' || co.conname || ' ' || pg_get_constraintdef(co.oid)
  FROM t JOIN pg_constraint co ON co.conrelid = t.oid
  UNION ALL
  SELECT 'POLICY ' || t.tn || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive
         || ' roles=' || (SELECT string_agg(CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r)::text END, ',' ORDER BY 1) FROM unnest(p.polroles) r)
         || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
         || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
  FROM t JOIN pg_policy p ON p.polrelid = t.oid
  UNION ALL
  SELECT 'TRIGGER ' || t.tn || ' ' || pg_get_triggerdef(tg.oid) FROM t JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
  UNION ALL
  SELECT 'FUNCTION ' || s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p JOIN s ON s.oid = p.pronamespace
  WHERE NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
) x ORDER BY 1;"

# ── 1. Preflight: can we reach both ends, and will the dump be complete? ───────────────────────────
log "preflight: source"
PRE="$(q_src "SELECT current_setting('server_version_num')::int / 10000, current_setting('server_version'), (rolsuper OR rolbypassrls)::text FROM pg_roles WHERE rolname = current_user" 2>"$WORKDIR/pre.err")" \
  || die2 "cannot connect to the source database: $(head -c 300 "$WORKDIR/pre.err" | tr '\n' ' ')"
SERVER_MAJOR="$(printf '%s' "$PRE" | cut -d'|' -f1)"
SERVER_VERSION="$(printf '%s' "$PRE" | cut -d'|' -f2)"
BYPASS="$(printf '%s' "$PRE" | cut -d'|' -f3)"
[ -n "$SERVER_MAJOR" ] || die2 "source preflight returned nothing."
[ "$CLIENT_MAJOR" -ge "$SERVER_MAJOR" ] || die2 "pg_dump $CLIENT_MAJOR is older than the source server ($SERVER_VERSION)."
# RLS is on for every tenant table. pg_read_all_data does NOT bypass it, so a role without BYPASSRLS
# would either make pg_dump abort or — worse, with row_security on — dump a filtered subset that then
# "verifies" against counts filtered the same way. Refuse up front.
[ "$BYPASS" = "true" ] || die2 "the source role lacks BYPASSRLS: RLS would hide rows from the dump. See scripts/backup-drill/create-drill-role.sql."

log "preflight: target"
TPRE="$(q_tgt "SELECT (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user), current_setting('server_version_num')::int / 10000, (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f'))" 2>"$WORKDIR/tpre.err")" \
  || die2 "cannot connect to the target database: $(head -c 300 "$WORKDIR/tpre.err" | tr '\n' ' ')"
[ "$(printf '%s' "$TPRE" | cut -d'|' -f1)" = "true" ] || die2 "the target role must be a superuser (restore recreates auth-owned objects)."
[ "$(printf '%s' "$TPRE" | cut -d'|' -f2)" = "$SERVER_MAJOR" ] || die2 "target major version $(printf '%s' "$TPRE" | cut -d'|' -f2) != source major $SERVER_MAJOR."
[ "$(printf '%s' "$TPRE" | cut -d'|' -f3)" = "0" ] || die2 "target public schema is not empty — refusing to restore into anything but a fresh drill database."

# ── 2. One REPEATABLE READ session exports a snapshot; counts are taken inside it ─────────────────
# psql reads from a FIFO held open on fd 3, so the transaction stays open while pg_dump imports the
# snapshot. Portable to bash 3.2 (no coproc).
mkfifo "$WORKDIR/in" || die2 "mkfifo failed."
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 -d "$SRC" <"$WORKDIR/in" >"$WORKDIR/session.out" 2>"$WORKDIR/session.err" &
PSQL_PID=$!
exec 3>"$WORKDIR/in"

send() { printf '%s\n' "$1" >&3 || die2 "the snapshot session went away."; }

wait_for() {
  local marker="$1" limit="$2" waited=0
  while ! grep -qx "$marker" "$WORKDIR/session.out" 2>/dev/null; do
    kill -0 "$PSQL_PID" 2>/dev/null || die2 "the snapshot session exited: $(head -c 300 "$WORKDIR/session.err" | tr '\n' ' ')"
    [ "$waited" -lt "$((limit * 5))" ] || die2 "timed out after ${limit}s waiting for the snapshot session."
    sleep 0.2
    waited=$((waited + 1))
  done
}

T0="$(now)"
send "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"
send "SELECT 'SNAPSHOT' || E'\t' || pg_export_snapshot();"
send '\echo __SNAPSHOT_DONE__'
wait_for __SNAPSHOT_DONE__ 60
SNAPSHOT="$(grep '^SNAPSHOT' "$WORKDIR/session.out" | cut -f2)"
[ -n "$SNAPSHOT" ] || die2 "pg_export_snapshot returned nothing."
log "snapshot exported"

log "counting rows at the snapshot"
# pg_get_constraintdef/pg_get_expr omit schema names that are on the search_path, and the source and
# target roles have different defaults. Pin it so both sides render fully-qualified names.
send "SET LOCAL search_path = pg_catalog;"
send "$COUNT_SQL"
send "$INVENTORY_SQL"
send "SELECT 'ROLE' || E'\t' || rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY 1;"
send '\echo __COUNTS_DONE__'
wait_for __COUNTS_DONE__ 900
grep '^COUNT' "$WORKDIR/session.out" | cut -f2- | sort >"$WORKDIR/src.counts"
grep '^INV' "$WORKDIR/session.out" | cut -f2- | sort >"$WORKDIR/src.inventory"
grep '^ROLE' "$WORKDIR/session.out" | cut -f2 >"$WORKDIR/src.roles"
TABLES="$(wc -l <"$WORKDIR/src.counts" | tr -d ' ')"
[ "$TABLES" -ge 1 ] && [ "$TABLES" -ge "$MIN_TABLES" ] \
  || die2 "the source exposes $TABLES tables in [$SCHEMAS], fewer than DRILL_MIN_TABLES=$MIN_TABLES — wrong database or missing grants."

# ── 3. Dump at the exported snapshot ──────────────────────────────────────────────────────────────
log "dumping [$SCHEMAS] with $("$PG_DUMP" --version)"
"$PG_DUMP" -d "$SRC" --snapshot="$SNAPSHOT" --format=custom --no-owner --lock-wait-timeout=60s \
  "${SCHEMA_FLAGS[@]}" --file="$DUMP" 2>"$WORKDIR/dump.err"
DUMP_RC=$?
# pg_dump has imported the snapshot by now (or failed); the exporting transaction can end.
send "COMMIT;"
send '\q'
exec 3>&-
wait "$PSQL_PID" 2>/dev/null
PSQL_PID=""
[ "$DUMP_RC" -eq 0 ] || die2 "pg_dump failed (exit $DUMP_RC): $(head -c 500 "$WORKDIR/dump.err" | tr '\n' ' ')"
[ -s "$DUMP" ] || die2 "pg_dump exited 0 but wrote an empty file."
T1="$(now)"
DUMP_BYTES="$(wc -c <"$DUMP" | tr -d ' ')"
log "dump complete: $DUMP_BYTES bytes in $((T1 - T0))s"

# ── 4. Prepare the target, then restore ───────────────────────────────────────────────────────────
# Roles are cluster-level and never in a pg_dump. Policies and GRANTs name them, so create every
# source role name the target lacks — as bare NOLOGIN roles: no attributes, no passwords, no members.
ROLE_LIST="$(tr '\n' ',' <"$WORKDIR/src.roles" | sed 's/,$//')"
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 -d "$TARGET_URL" -v roles="$ROLE_LIST" >"$WORKDIR/prep.out" 2>"$WORKDIR/prep.err" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', r)
FROM unnest(string_to_array(:'roles', ',')) AS r
WHERE r <> '' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec
SQL
[ $? -eq 0 ] || die2 "could not create source roles on the target: $(head -c 300 "$WORKDIR/prep.err" | tr '\n' ' ')"

# The image ships its own minimal `auth` (and other) schemas. Drop every dumped schema — `public`
# included, which was verified empty above and which an explicit `-n public` dump re-creates — so the
# restore is the only source of truth for what is in them.
for s in $SCHEMAS; do
  q_tgt "DROP SCHEMA IF EXISTS \"$s\" CASCADE;" >/dev/null 2>"$WORKDIR/prep.err" \
    || die2 "could not reset schema $s on the target: $(head -c 300 "$WORKDIR/prep.err" | tr '\n' ' ')"
done

log "restoring"
T2="$(now)"
# --verbose only so each error is preceded by its "from TOC entry" line (object identity, no data).
"$PG_RESTORE" -d "$TARGET_URL" --no-owner --verbose "$DUMP" 2>"$WORKDIR/restore.err"
RESTORE_RC=$?
T3="$(now)"
log "restore finished in $((T3 - T2))s (pg_restore exit $RESTORE_RC)"

# pg_restore continues past errors and exits 1 if any occurred. Each error is two-plus lines:
#   pg_restore: from TOC entry N; ... <object>
#   pg_restore: error: could not execute query: ERROR:  <message>
# The ALLOW-LIST below is deliberately EMPTY. Every error seen in the local proof against
# supabase/postgres was eliminated by preparing the target instead (roles, schema reset). Add an
# entry only with a comment explaining why that exact error is harmless — and never a broad pattern.
RESTORE_ALLOW_LIST=()

FINDINGS=0
REPORT_LINES=()

grep '^pg_restore: error:' "$WORKDIR/restore.err" | grep -v '^pg_restore: error: could not execute query' >"$WORKDIR/restore.fatal"
UNEXPECTED=0
# Walk the error blocks: a block starts at "from TOC entry" and carries the ERROR message.
awk '
  /^pg_restore: from TOC entry/ { toc = $0; next }
  /^pg_restore: error: could not execute query: ERROR:/ {
    sub(/^pg_restore: error: could not execute query: /, ""); print (toc == "" ? "(unknown TOC entry)" : toc) "\037" $0; toc = ""
  }
' "$WORKDIR/restore.err" >"$WORKDIR/restore.errors"

# Postgres error text can quote row values (DETAIL: Key (email)=(…), invalid input syntax: "…").
# Only DETAIL-free ERROR lines are kept by the awk above; values are additionally redacted here.
redact() { sed -E -e 's/\([^()]*\)=\([^()]*\)/(…)=(…)/g' -e 's/: "[^"]*"$/: "…"/' -e "s/'[^']*'/'…'/g" | cut -c1-300; }

while IFS="$(printf '\037')" read -r toc msg; do
  [ -n "$toc$msg" ] || continue
  allowed=0
  for pat in ${RESTORE_ALLOW_LIST[@]+"${RESTORE_ALLOW_LIST[@]}"}; do
    if printf '%s' "$msg" | grep -Eq "$pat"; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    UNEXPECTED=$((UNEXPECTED + 1))
    echo "  ✗ restore error: $(printf '%s' "$toc" | sed 's/^pg_restore: //' | cut -c1-200)"
    echo "      $(printf '%s' "$msg" | redact)"
  fi
done <"$WORKDIR/restore.errors"

if [ -s "$WORKDIR/restore.fatal" ]; then
  echo "  ✗ pg_restore reported a non-query error:"
  redact <"$WORKDIR/restore.fatal" | sed 's/^/      /'
  UNEXPECTED=$((UNEXPECTED + 1))
fi
if [ "$RESTORE_RC" -ne 0 ] && [ "$UNEXPECTED" -eq 0 ] && [ ! -s "$WORKDIR/restore.errors" ]; then
  # Non-zero exit with nothing we could classify: never assume it was benign.
  echo "  ✗ pg_restore exited $RESTORE_RC without a classifiable error."
  UNEXPECTED=$((UNEXPECTED + 1))
fi
if [ "$UNEXPECTED" -gt 0 ]; then
  FINDINGS=$((FINDINGS + 1))
  REPORT_LINES+=("- ❌ **$UNEXPECTED restore error(s)** outside the allow-list (see job log; values redacted)")
else
  REPORT_LINES+=("- ✅ restore completed with no errors outside the allow-list")
fi

# ── TEST HOOK — damage the restored copy on purpose, to prove the checks below can fail ──────────
if [ -n "${DRILL_TEST_POST_RESTORE_SQL:-}" ]; then
  log "TEST HOOK: applying DRILL_TEST_POST_RESTORE_SQL to the target"
  q_tgt "$DRILL_TEST_POST_RESTORE_SQL" >/dev/null 2>"$WORKDIR/hook.err" \
    || die2 "test hook failed: $(head -c 300 "$WORKDIR/hook.err" | tr '\n' ' ')"
fi

# ── 5. Verify ─────────────────────────────────────────────────────────────────────────────────────
log "verifying row counts and inventory on the restored copy"
q_tgt "$COUNT_SQL" 2>"$WORKDIR/verify.err" | cut -f2- | sort >"$WORKDIR/tgt.counts"
[ "${PIPESTATUS[0]}" -eq 0 ] || die2 "could not count rows on the target: $(head -c 300 "$WORKDIR/verify.err" | tr '\n' ' ')"
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 -d "$TARGET_URL" -c "SET search_path = pg_catalog" -c "$INVENTORY_SQL" 2>"$WORKDIR/verify.err" | cut -f2- | sort >"$WORKDIR/tgt.inventory"
[ "${PIPESTATUS[0]}" -eq 0 ] || die2 "could not read the target inventory: $(head -c 300 "$WORKDIR/verify.err" | tr '\n' ' ')"

# Row counts: join on table name so a missing table is a mismatch, not a silent omission.
COUNT_DIFF="$(awk -F'\t' '
  NR == FNR { src[$1] = $2; next }
  { tgt[$1] = $2 }
  END {
    for (t in src) if (!(t in tgt)) printf "%s\t%s\tMISSING\n", t, src[t];
      else if (src[t] != tgt[t]) printf "%s\t%s\t%s\n", t, src[t], tgt[t];
    for (t in tgt) if (!(t in src)) printf "%s\tABSENT\t%s\n", t, tgt[t];
  }' "$WORKDIR/src.counts" "$WORKDIR/tgt.counts" | sort)"
TOTAL_ROWS="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORKDIR/src.counts")"
if [ -n "$COUNT_DIFF" ]; then
  FINDINGS=$((FINDINGS + 1))
  N="$(printf '%s\n' "$COUNT_DIFF" | wc -l | tr -d ' ')"
  echo "  ✗ row-count mismatch on $N table(s) (table, source, restored):"
  printf '%s\n' "$COUNT_DIFF" | sed 's/^/      /'
  REPORT_LINES+=("- ❌ **row-count mismatch on $N table(s)**")
else
  REPORT_LINES+=("- ✅ exact row counts match on all $TABLES tables ($TOTAL_ROWS rows at the snapshot)")
fi

INV_DIFF="$(diff "$WORKDIR/src.inventory" "$WORKDIR/tgt.inventory")"
INV_ITEMS="$(wc -l <"$WORKDIR/src.inventory" | tr -d ' ')"
if [ -n "$INV_DIFF" ]; then
  FINDINGS=$((FINDINGS + 1))
  N="$(printf '%s\n' "$INV_DIFF" | grep -c '^[<>]')"
  echo "  ✗ schema inventory differs ($N line(s); < source, > restored):"
  printf '%s\n' "$INV_DIFF" | grep '^[<>]' | head -50 | cut -c1-300 | sed 's/^/      /'
  REPORT_LINES+=("- ❌ **schema inventory differs** ($N line(s))")
else
  REPORT_LINES+=("- ✅ schema inventory identical ($INV_ITEMS objects: relations, columns, indexes, constraints, RLS flags, policies, triggers, functions)")
fi

# ── 6. Report — aggregate metadata only ───────────────────────────────────────────────────────────
DUMP_S=$((T1 - T0)); RESTORE_S=$((T3 - T2))
POLICIES="$(grep -c '^POLICY ' "$WORKDIR/src.inventory")"
RLS_TABLES="$(grep -c '^RELATION .* rls=true' "$WORKDIR/src.inventory")"
if [ "$FINDINGS" -eq 0 ]; then HEADLINE="### ✅ Backup-restore drill VERIFIED"; else HEADLINE="### ❌ Backup-restore drill FOUND $FINDINGS PROBLEM(S)"; fi

summary "$HEADLINE" "" \
  "| | |" "|---|---|" \
  "| Source server | PostgreSQL $SERVER_VERSION |" \
  "| Client | $("$PG_DUMP" --version) |" \
  "| Schemas | $SCHEMAS |" \
  "| Tables / rows | $TABLES / $TOTAL_ROWS |" \
  "| RLS-enabled relations / policies | $RLS_TABLES / $POLICIES |" \
  "| Dump size | $DUMP_BYTES bytes |" \
  "| Snapshot + count + dump | ${DUMP_S}s |" \
  "| Restore | ${RESTORE_S}s |" \
  "| **Measured RTO (dump + restore)** | **$((DUMP_S + RESTORE_S))s** |" \
  "" "${REPORT_LINES[@]}" "" \
  "<details><summary>Per-table row counts at the snapshot</summary>" "" \
  "| Table | Rows |" "|---|---:|"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  awk -F'\t' '{ printf "| `%s` | %s |\n", $1, $2 }' "$WORKDIR/src.counts" >>"$GITHUB_STEP_SUMMARY"
fi
summary "" "</details>" "" "_Only names, counts, sizes and timings are reported. The dump never leaves the runner and is deleted on exit._"

echo
printf '%s\n' "${REPORT_LINES[@]}"
echo "tables=$TABLES rows=$TOTAL_ROWS dump_bytes=$DUMP_BYTES dump_s=$DUMP_S restore_s=$RESTORE_S rto_s=$((DUMP_S + RESTORE_S))"

if [ "$FINDINGS" -gt 0 ]; then
  echo "❌ DRILL FOUND $FINDINGS PROBLEM(S) — the backup is NOT verified (exit 1)."
  exit 1
fi
echo "✅ DRILL VERIFIED — production is restorable and the restored copy is complete (exit 0)."
exit 0
