#!/usr/bin/env bash
#
# Production backup-restore drill, plus the evidence capture/verify pair used in a real restore.
#
# MODES
#   run-drill.sh                                  the weekly drill (default)
#   run-drill.sh capture <evidence-out> [dump-out]  snapshot the SOURCE: write its exact per-table
#                                                 counts + schema inventory (metadata only) and, if
#                                                 asked, a pg_dump taken at the SAME snapshot
#   run-drill.sh verify <evidence-file>           compare a restored DESTINATION against saved
#                                                 evidence (read-only; nothing is changed)
#
# WHAT THE DRILL PROVES
# ---------------------
# That a logical dump of production can be taken, restored into an empty Postgres of the same major
# version, and that the restored copy is COMPLETE: every table's exact row count matches the source
# at one consistent snapshot, and the schema inventory (relations, columns, indexes, constraints, RLS
# flags, policies, triggers + enabled state, function definitions, enum/domain/composite types) of
# every dumped schema is identical.
#
# It does NOT prove Supabase's managed daily backups / PITR work — that is a separate, manual,
# quarterly step. See docs/runbooks/backup-restore.md.
#
# EXIT CODES — the did-not-run/found-nothing distinction is the point (.claude/rules/verification.md)
#   0  VERIFIED (drill, verify) / CAPTURED (capture)
#   1  RAN and FOUND A PROBLEM — restore errors outside the allow-list, a row-count mismatch, or an
#      inventory mismatch. The backup / the restored destination is not trustworthy.
#   2  COULD NOT RUN — missing configuration, unreachable database, wrong client version, a role that
#      cannot see every row, a target that is not provably a fresh drill database, a failed dump,
#      malformed evidence. Exit 2 is NOT a pass. Nothing was verified.
#
# INPUTS (environment)
#   DRILL_SOURCE_URL       drill/capture. Read-only role with BYPASSRLS (create-drill-role.sql). No
#                          sslmode in the URL — TLS is set by DRILL_SOURCE_SSLMODE so it cannot degrade.
#   DRILL_TARGET_URL       drill. SUPERUSER on a fresh, EPHEMERAL Postgres on a loopback host. Every
#                          dumped schema is DROPPED there, so see the guards below.
#   DRILL_TARGET_MARKER    drill. Must equal the run_id in the target's drill_meta.target_marker table,
#                          which the workflow creates in the service container. Proves the target is
#                          the container this run created, not any database that happens to be empty.
#   DRILL_VERIFY_URL       verify. The restored destination (a role with BYPASSRLS, e.g. postgres).
#   DRILL_SOURCE_SSLMODE / DRILL_VERIFY_SSLMODE  default verify-full. Local tests only: disable.
#   DRILL_SOURCE_SSLROOTCERT  default scripts/parity/supabase-root-ca.pem (Supabase Root 2021 CA); also
#                          used for DRILL_VERIFY_URL.
#   DRILL_SCHEMAS          drill/capture. Default "public auth". verify reads them from the evidence.
#   DRILL_MIN_TABLES       default 1. The source must expose at least this many tables, so a drill
#                          pointed at an empty or wrong database cannot pass vacuously.
#   DRILL_PG_BIN           optional directory holding pg_dump/pg_restore/psql (major >= 17).
#   DRILL_TEST_POST_RESTORE_SQL  TEST ONLY. SQL run against the TARGET after restore, to prove that a
#                          damaged restore is detected (exit 1). The workflow never sets it.
#   GITHUB_STEP_SUMMARY    optional. When set, the aggregate report is appended there.
#
# PII: in drill mode production rows exist only in the dump file inside a private temp dir (umask 077)
# and in the ephemeral target; neither is printed or uploaded, and the temp dir is deleted by an EXIT
# trap. Only table names, row COUNTS, sizes and timings are reported. Restore error MESSAGE TEXT is
# never printed (it can quote row values); only the failing object's TOC entry and a condition name.
# Evidence files hold the same metadata (names, counts, schema definitions) and never row data.
# capture's dump-out, when requested, IS production data: the operator chooses where it lives.
#
# Deliberately NOT `set -e`: every failure below is classified explicitly as exit 1 or exit 2.
set -uo pipefail
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_HEADER="# tims-backup-drill evidence v1"

WORKDIR=""
PSQL_PID=""

cleanup() {
  exec 3>&- 2>/dev/null
  if [ -n "$PSQL_PID" ]; then kill "$PSQL_PID" 2>/dev/null; wait "$PSQL_PID" 2>/dev/null; fi
  # The drill's dump holds production PII. It must not outlive this process on any path.
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
field() { printf '%s' "$1" | cut -d'|' -f"$2"; }

# ── Mode ─────────────────────────────────────────────────────────────────────────────────────────
MODE=drill
EVIDENCE_OUT=""; DUMP_OUT=""; EVIDENCE_IN=""
case "${1:-}" in
  "") ;;
  capture)
    MODE=capture; EVIDENCE_OUT="${2:-}"; DUMP_OUT="${3:-}"
    [ -n "$EVIDENCE_OUT" ] || die2 "usage: run-drill.sh capture <evidence-out> [dump-out]"
    [ ! -e "$EVIDENCE_OUT" ] || die2 "refusing to overwrite existing evidence file $EVIDENCE_OUT"
    [ -z "$DUMP_OUT" ] || [ ! -e "$DUMP_OUT" ] || die2 "refusing to overwrite existing dump file $DUMP_OUT" ;;
  verify)
    MODE=verify; EVIDENCE_IN="${2:-}"
    [ -n "$EVIDENCE_IN" ] || die2 "usage: run-drill.sh verify <evidence-file>"
    [ -r "$EVIDENCE_IN" ] || die2 "cannot read evidence file $EVIDENCE_IN" ;;
  *) die2 "unknown mode '$1' — usage: run-drill.sh [capture <evidence-out> [dump-out] | verify <evidence-file>]" ;;
esac

# ── Configuration ─────────────────────────────────────────────────────────────────────────────────
SOURCE_URL="${DRILL_SOURCE_URL:-}"
TARGET_URL="${DRILL_TARGET_URL:-}"
VERIFY_URL="${DRILL_VERIFY_URL:-}"
SSLROOTCERT="${DRILL_SOURCE_SSLROOTCERT:-$REPO_ROOT/scripts/parity/supabase-root-ca.pem}"
MIN_TABLES="${DRILL_MIN_TABLES:-1}"
TARGET_MARKER="${DRILL_TARGET_MARKER:-}"

case "$MIN_TABLES" in ''|*[!0-9]*) die2 "DRILL_MIN_TABLES must be a non-negative integer." ;; esac

# URL + TLS parameters. The URL must not carry its own sslmode: TLS is set by the mode variable, so a
# secret's contents can never downgrade verification.
with_tls() { # name url sslmode
  local name="$1" url="$2" mode="$3" params
  case "$url" in postgres://*|postgresql://*) ;; *) die2 "$name must be a postgres:// or postgresql:// URL." ;; esac
  case "$url" in
    *sslmode=*|*sslrootcert=*)
      die2 "$name must not carry sslmode/sslrootcert — set the matching *_SSLMODE variable instead, so TLS verification cannot be downgraded by the URL." ;;
  esac
  case "$mode" in
    verify-full|verify-ca)
      [ -r "$SSLROOTCERT" ] || die2 "sslmode=$mode needs a readable root CA at $SSLROOTCERT."
      params="sslmode=$mode&sslrootcert=$SSLROOTCERT" ;;
    disable|require) params="sslmode=$mode" ;;
    *) die2 "sslmode '$mode' for $name is not recognised." ;;
  esac
  case "$url" in *\?*) echo "$url&$params" ;; *) echo "$url?$params" ;; esac
}

if [ "$MODE" = verify ]; then
  [ -n "$VERIFY_URL" ] || die2 "DRILL_VERIFY_URL is not set."
  DST="$(with_tls DRILL_VERIFY_URL "$VERIFY_URL" "${DRILL_VERIFY_SSLMODE:-verify-full}")" || exit 2
  head -1 "$EVIDENCE_IN" | grep -qx "$EVIDENCE_HEADER" || die2 "$EVIDENCE_IN is not a v1 evidence file."
  SCHEMAS="$(grep '^# schemas=' "$EVIDENCE_IN" | head -1 | cut -d= -f2-)"
  [ -n "$SCHEMAS" ] || die2 "evidence file has no schemas header."
else
  [ -n "$SOURCE_URL" ] || die2 "DRILL_SOURCE_URL is not set (workflow secret PROD_BACKUP_DRILL_URL)."
  SRC="$(with_tls DRILL_SOURCE_URL "$SOURCE_URL" "${DRILL_SOURCE_SSLMODE:-verify-full}")" || exit 2
  SCHEMAS="${DRILL_SCHEMAS:-public auth}"
fi

SCHEMA_ARRAY=""
SCHEMA_FLAGS=()
for s in $SCHEMAS; do
  # Identifiers are interpolated into SQL below, so accept only plain lower-case names.
  printf '%s' "$s" | grep -Eq '^[a-z_][a-z0-9_]*$' || die2 "invalid schema name: $s"
  [ "$s" != "drill_meta" ] || die2 "drill_meta holds the target marker and can never be a dumped schema."
  SCHEMA_ARRAY="${SCHEMA_ARRAY:+$SCHEMA_ARRAY,}'$s'"
  SCHEMA_FLAGS+=(-n "$s")
done
[ -n "$SCHEMA_ARRAY" ] || die2 "no schemas selected."
SCHEMA_ARRAY="ARRAY[$SCHEMA_ARRAY]::text[]"

# The drill target is DESTRUCTIVELY prepared (every dumped schema is dropped), so it must be the
# ephemeral local database this run created, and nothing else. Guards, all before the first
# destructive statement:
#   1. (here, before any connection) the URL is a plain single loopback host with NO query string.
#      libpq lets `?hostaddr=`, `?host=`, `?service=` and comma host lists override the host the URL
#      appears to name, so any of them could send "localhost" somewhere else. None is accepted.
#   2. (here) libpq environment variables that fill in unspecified parameters are cleared, so
#      PGHOSTADDR / PGSERVICE cannot redirect a URL that names no hostaddr/service of its own.
#   3. (after connecting) superuser; same major; a system_identifier different from the source's; a
#      loopback/private server address (a Docker service container reports its bridge IP, so loopback
#      alone cannot be required); the run's MARKER present in drill_meta.target_marker; and every
#      selected schema FRESH — `public` has no relations, and no table in any selected schema holds a
#      single row. The ONE exception is auth.schema_migrations, GoTrue's migration-version ledger, which
#      the pristine supabase/postgres image ships with 7 version strings (no user data). An empty `public` alone is not enough: a real database with an empty public but a
#      populated auth.users would otherwise be wiped.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGOPTIONS \
      PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS
if [ "$MODE" = drill ]; then
  [ -n "$TARGET_URL" ] || die2 "DRILL_TARGET_URL is not set."
  if ! printf '%s' "$TARGET_URL" \
    | grep -Eq '^postgres(ql)?://[^@/?#,]+@(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+$'; then
    die2 "DRILL_TARGET_URL must be exactly postgresql://user:password@{localhost|127.0.0.1|[::1]}[:port]/dbname with no query parameters (hostaddr/host/service) and no host list. The drill only restores into an ephemeral local database."
  fi
  printf '%s' "$TARGET_MARKER" | grep -Eq '^[A-Za-z0-9_-]{1,64}$' \
    || die2 "DRILL_TARGET_MARKER is not set (or malformed). The workflow writes it into the service container; without it the target cannot be proven to be this run's disposable database."
fi

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

# One-shot query helper. -X ignores ~/.psqlrc so a developer's settings cannot change the output.
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }

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
),
ty AS (
  SELECT ty.oid, s.nspname || '.' || ty.typname AS tyn, ty.typtype, ty.typbasetype, ty.typtypmod, ty.typnotnull, ty.typdefault, ty.typrelid
  FROM pg_type ty JOIN s ON s.oid = ty.typnamespace
  WHERE ty.typtype IN ('e', 'd', 'c')
    -- a table's implicit row type is covered by its RELATION/COLUMN lines
    AND (ty.typtype <> 'c' OR (SELECT relkind FROM pg_class WHERE oid = ty.typrelid) = 'c')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = ty.oid AND d.deptype = 'e')
)
SELECT 'INV' || E'\t' || regexp_replace(line, '\s+', ' ', 'g') FROM (
  SELECT 'RELATION ' || tn || ' kind=' || relkind::text || ' rls=' || relrowsecurity || ' force_rls=' || relforcerowsecurity AS line FROM t
  UNION ALL
  SELECT 'COLUMN ' || t.tn || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
         || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text
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
  -- tgenabled: a trigger restored DISABLED (e.g. an append-only guard) is as broken as a missing one.
  SELECT 'TRIGGER ' || t.tn || ' ' || pg_get_triggerdef(tg.oid) || ' enabled=' || tg.tgenabled::text
  FROM t JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
  UNION ALL
  -- The DEFINITION, not just the signature: a guard function restored with a permissive body must
  -- not verify. pg_get_functiondef carries body, language, volatility, strictness, SECURITY DEFINER and
  -- SET clauses, and no owner (ownership is dropped by --no-owner). Aggregates have no functiondef,
  -- so their prosrc is hashed. The attributes are repeated explicitly so a diff says what changed.
  SELECT 'FUNCTION ' || s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         || ' kind=' || p.prokind::text || ' secdef=' || p.prosecdef || ' volatile=' || p.provolatile::text
         || ' strict=' || p.proisstrict || ' leakproof=' || p.proleakproof || ' parallel=' || p.proparallel::text
         || ' config=' || coalesce(array_to_string(p.proconfig, ','), '')
         || ' def_md5=' || md5(CASE WHEN p.prokind IN ('f', 'p', 'w') THEN pg_get_functiondef(p.oid) ELSE coalesce(p.prosrc, '') END)
  FROM pg_proc p JOIN s ON s.oid = p.pronamespace
  WHERE NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  -- Enum labels IN ORDER: a renamed, missing or reordered label changes what the application can
  -- store and how it sorts, while every table and count still matches.
  SELECT 'TYPE enum ' || ty.tyn || ' labels=' || coalesce((SELECT string_agg(quote_literal(e.enumlabel), ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = ty.oid), '')
  FROM ty WHERE ty.typtype = 'e'
  UNION ALL
  SELECT 'TYPE domain ' || ty.tyn || ' base=' || format_type(ty.typbasetype, ty.typtypmod)
         || ' notnull=' || ty.typnotnull || ' default=' || coalesce(ty.typdefault, '')
         || ' checks=' || coalesce((SELECT string_agg(co.conname || ':' || pg_get_constraintdef(co.oid), ',' ORDER BY co.conname) FROM pg_constraint co WHERE co.contypid = ty.oid), '')
  FROM ty WHERE ty.typtype = 'd'
  UNION ALL
  SELECT 'TYPE composite ' || ty.tyn || ' attrs=' || coalesce((SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = ty.typrelid AND a.attnum > 0 AND NOT a.attisdropped), '')
  FROM ty WHERE ty.typtype = 'c'
) x ORDER BY 1;"

# Same shape for the source and for a verify destination: major | version | can-see-every-row | sysid.
ROLE_PREFLIGHT_SQL="SELECT current_setting('server_version_num')::int / 10000, current_setting('server_version'), (rolsuper OR rolbypassrls)::text, (SELECT system_identifier::text FROM pg_control_system()) FROM pg_roles WHERE rolname = current_user"

# Counts + inventory of an already-restored database, into <prefix>.counts / <prefix>.inventory.
measure() { # url prefix label
  q "$1" "$COUNT_SQL" 2>"$WORKDIR/measure.err" | cut -f2- | sort >"$2.counts"
  [ "${PIPESTATUS[0]}" -eq 0 ] || die2 "could not count rows on the $3: $(head -c 300 "$WORKDIR/measure.err" | tr '\n' ' ')"
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -d "$1" -c "SET search_path = pg_catalog" -c "$INVENTORY_SQL" 2>"$WORKDIR/measure.err" | cut -f2- | sort >"$2.inventory"
  [ "${PIPESTATUS[0]}" -eq 0 ] || die2 "could not read the $3 inventory: $(head -c 300 "$WORKDIR/measure.err" | tr '\n' ' ')"
}

FINDINGS=0
REPORT_LINES=()

# Compare expected (<a>.counts/.inventory) with actual (<b>.*). Appends to FINDINGS / REPORT_LINES.
compare() { # expected-prefix actual-prefix actual-label
  local diffc n invd items total tables
  # Row counts: join on table name so a missing table is a mismatch, not a silent omission.
  diffc="$(awk -F'\t' '
    NR == FNR { src[$1] = $2; next }
    { tgt[$1] = $2 }
    END {
      for (t in src) if (!(t in tgt)) printf "%s\t%s\tMISSING\n", t, src[t];
        else if (src[t] != tgt[t]) printf "%s\t%s\t%s\n", t, src[t], tgt[t];
      for (t in tgt) if (!(t in src)) printf "%s\tABSENT\t%s\n", t, tgt[t];
    }' "$1.counts" "$2.counts" | sort)"
  total="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$1.counts")"
  tables="$(wc -l <"$1.counts" | tr -d ' ')"
  if [ -n "$diffc" ]; then
    FINDINGS=$((FINDINGS + 1))
    n="$(printf '%s\n' "$diffc" | wc -l | tr -d ' ')"
    echo "  ✗ row-count mismatch on $n table(s) (table, expected, $3):"
    printf '%s\n' "$diffc" | sed 's/^/      /'
    REPORT_LINES+=("- ❌ **row-count mismatch on $n table(s)**")
  else
    REPORT_LINES+=("- ✅ exact row counts match on all $tables tables ($total rows at the snapshot)")
  fi

  invd="$(diff "$1.inventory" "$2.inventory")"
  items="$(wc -l <"$1.inventory" | tr -d ' ')"
  if [ -n "$invd" ]; then
    FINDINGS=$((FINDINGS + 1))
    n="$(printf '%s\n' "$invd" | grep -c '^[<>]')"
    echo "  ✗ schema inventory differs ($n line(s); < expected, > $3):"
    printf '%s\n' "$invd" | grep '^[<>]' | head -50 | cut -c1-300 | sed 's/^/      /'
    REPORT_LINES+=("- ❌ **schema inventory differs** ($n line(s))")
  else
    REPORT_LINES+=("- ✅ schema inventory identical ($items objects: relations, columns, indexes, constraints, RLS flags, policies, triggers incl. enabled state, full function definitions, enum/domain/composite types)")
  fi
}

# ══ verify: a restored destination against saved evidence ══════════════════════════════════════════
if [ "$MODE" = verify ]; then
  log "verify: destination against $EVIDENCE_IN"
  PRE="$(q "$DST" "$ROLE_PREFLIGHT_SQL" 2>"$WORKDIR/pre.err")" \
    || die2 "cannot connect to the destination: $(head -c 300 "$WORKDIR/pre.err" | tr '\n' ' ')"
  [ "$(field "$PRE" 3)" = "true" ] \
    || die2 "the destination role lacks BYPASSRLS: RLS would hide rows and the counts would prove nothing."
  grep '^COUNT' "$EVIDENCE_IN" | cut -f2- | sort >"$WORKDIR/exp.counts"
  grep '^INV' "$EVIDENCE_IN" | cut -f2- | sort >"$WORKDIR/exp.inventory"
  [ -s "$WORKDIR/exp.counts" ] || die2 "evidence file lists no tables."
  measure "$DST" "$WORKDIR/dst" destination
  compare "$WORKDIR/exp" "$WORKDIR/dst" destination
  echo
  printf '%s\n' "${REPORT_LINES[@]}"
  if [ "$FINDINGS" -gt 0 ]; then
    summary "### ❌ Restore verification FOUND $FINDINGS PROBLEM(S)" "" "${REPORT_LINES[@]}"
    echo "❌ DESTINATION DOES NOT MATCH THE EVIDENCE ($FINDINGS problem(s)) — do not cut over (exit 1)."
    exit 1
  fi
  summary "### ✅ Restore verification: destination matches the evidence" "" "${REPORT_LINES[@]}"
  echo "✅ DESTINATION MATCHES THE EVIDENCE captured at $(grep '^# captured_at=' "$EVIDENCE_IN" | cut -d= -f2-) (exit 0)."
  exit 0
fi

# ── 1. Preflight: can we reach the source, and will the dump be complete? ────────────────────────
log "preflight: source"
PRE="$(q "$SRC" "$ROLE_PREFLIGHT_SQL" 2>"$WORKDIR/pre.err")" \
  || die2 "cannot connect to the source database: $(head -c 300 "$WORKDIR/pre.err" | tr '\n' ' ')"
SERVER_MAJOR="$(field "$PRE" 1)"
SERVER_VERSION="$(field "$PRE" 2)"
SOURCE_SYSID="$(field "$PRE" 4)"
[ -n "$SERVER_MAJOR" ] || die2 "source preflight returned nothing."
[ "$CLIENT_MAJOR" -ge "$SERVER_MAJOR" ] || die2 "pg_dump $CLIENT_MAJOR is older than the source server ($SERVER_VERSION)."
# RLS is on for every tenant table. pg_read_all_data does NOT bypass it, so a role without BYPASSRLS
# would either make pg_dump abort or — worse, with row_security on — dump a filtered subset that then
# "verifies" against counts filtered the same way. Refuse up front.
[ "$(field "$PRE" 3)" = "true" ] || die2 "the source role lacks BYPASSRLS: RLS would hide rows from the dump. See scripts/backup-drill/create-drill-role.sql."

if [ "$MODE" = drill ]; then
  log "preflight: target"
  TPRE="$(q "$TARGET_URL" "SELECT (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user), current_setting('server_version_num')::int / 10000, (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')), (SELECT system_identifier::text FROM pg_control_system()), (inet_server_addr() IS NULL OR inet_server_addr() <<= ANY (ARRAY['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']::inet[]))::text" 2>"$WORKDIR/tpre.err")" \
    || die2 "cannot connect to the target database: $(head -c 300 "$WORKDIR/tpre.err" | tr '\n' ' ')"
  [ "$(field "$TPRE" 1)" = "true" ] || die2 "the target role must be a superuser (restore recreates auth-owned objects)."
  [ "$(field "$TPRE" 2)" = "$SERVER_MAJOR" ] || die2 "target major version $(field "$TPRE" 2) != source major $SERVER_MAJOR."
  [ -n "$SOURCE_SYSID" ] || die2 "could not read the source system_identifier (pg_control_system), so the target cannot be proven to be a different cluster."
  [ "$(field "$TPRE" 4)" != "$SOURCE_SYSID" ] \
    || die2 "the target is the SAME Postgres cluster as the source (system_identifier $SOURCE_SYSID) — refusing to restore over it."
  [ "$(field "$TPRE" 5)" = "true" ] || die2 "the target server address is not loopback or private — refusing."

  MARK="$(q "$TARGET_URL" "SELECT string_agg(run_id, ',') FROM drill_meta.target_marker" 2>"$WORKDIR/tpre.err")" \
    || die2 "the target has no drill_meta.target_marker — it is not a database this workflow run created. Refusing."
  [ "$MARK" = "$TARGET_MARKER" ] \
    || die2 "the target's drill marker does not match DRILL_TARGET_MARKER — it was not created by this run. Refusing."

  [ "$(field "$TPRE" 3)" = "0" ] || die2 "target public schema is not empty — refusing to restore into anything but a fresh drill database."
  TROWS="$(q "$TARGET_URL" "SELECT 'TARGET_ROWS|' || coalesce(sum((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM ONLY %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint), 0) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = ANY($SCHEMA_ARRAY) AND (n.nspname, c.relname) <> ('auth', 'schema_migrations')" 2>"$WORKDIR/tpre.err")" \
    || die2 "could not prove the target schemas are empty: $(head -c 300 "$WORKDIR/tpre.err" | tr '\n' ' ')"
  [ "$TROWS" = "TARGET_ROWS|0" ] \
    || die2 "the target already holds $(printf '%s' "$TROWS" | cut -d'|' -f2) row(s) in [$SCHEMAS] — it is not a fresh drill database. Refusing to drop anything."
fi

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

# ── 3. Dump at the exported snapshot (capture: only if a dump-out was requested) ─────────────────
[ "$MODE" = capture ] && [ -n "$DUMP_OUT" ] && DUMP="$DUMP_OUT"
if [ "$MODE" = drill ] || [ -n "$DUMP_OUT" ]; then
  log "dumping [$SCHEMAS] with $("$PG_DUMP" --version)"
  "$PG_DUMP" -d "$SRC" --snapshot="$SNAPSHOT" --format=custom --no-owner --lock-wait-timeout=60s \
    "${SCHEMA_FLAGS[@]}" --file="$DUMP" 2>"$WORKDIR/dump.err"
  DUMP_RC=$?
else
  DUMP_RC=0
fi
# pg_dump has imported the snapshot by now (or failed); the exporting transaction can end.
send "COMMIT;"
send '\q'
exec 3>&-
wait "$PSQL_PID" 2>/dev/null
PSQL_PID=""
if [ "$MODE" = drill ] || [ -n "$DUMP_OUT" ]; then
  [ "$DUMP_RC" -eq 0 ] || die2 "pg_dump failed (exit $DUMP_RC): $(head -c 500 "$WORKDIR/dump.err" | tr '\n' ' ')"
  [ -s "$DUMP" ] || die2 "pg_dump exited 0 but wrote an empty file."
  DUMP_BYTES="$(wc -c <"$DUMP" | tr -d ' ')"
fi
T1="$(now)"

# ══ capture: persist the snapshot's evidence (metadata only) and stop ══════════════════════════════
if [ "$MODE" = capture ]; then
  {
    echo "$EVIDENCE_HEADER"
    echo "# captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# source_server=$SERVER_VERSION"
    echo "# snapshot=$SNAPSHOT"
    echo "# schemas=$SCHEMAS"
    echo "# dump=${DUMP_OUT:-none}"
    awk -F'\t' '{ printf "COUNT\t%s\t%s\n", $1, $2 }' "$WORKDIR/src.counts"
    awk '{ printf "INV\t%s\n", $0 }' "$WORKDIR/src.inventory"
  } >"$EVIDENCE_OUT" || die2 "could not write $EVIDENCE_OUT"
  log "evidence: $TABLES tables, $(wc -l <"$WORKDIR/src.inventory" | tr -d ' ') inventory lines → $EVIDENCE_OUT"
  [ -n "$DUMP_OUT" ] && log "dump at the same snapshot: $DUMP_BYTES bytes → $DUMP_OUT (production data — protect and delete it)"
  echo "✅ CAPTURED — evidence and dump share snapshot $SNAPSHOT (exit 0)."
  exit 0
fi
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
# included, which an explicit `-n public` dump re-creates — so the restore is the only source of truth
# for what is in them. Safe only because every guard in the target preflight passed.
for s in $SCHEMAS; do
  q "$TARGET_URL" "DROP SCHEMA IF EXISTS \"$s\" CASCADE;" >/dev/null 2>"$WORKDIR/prep.err" \
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

# NOTHING from a restore error's message text is ever printed. Postgres messages quote row values
# ("invalid input syntax …: "<value>"", DETAIL: Key (…)=(<value>)) and no sanitiser survives values
# that themselves contain quotes. What IS printed comes from two safe sources only:
#   - the TOC entry line: object type, schema-qualified name and owner (schema metadata, never data);
#   - a condition name picked from a CLOSED set by matching the message's leading phrase. The message
#     is matched, never echoed. pg_restore does not expose SQLSTATE, so this is the closest equivalent.
# The raw stderr stays in the private work dir and is deleted with it.
awk '
  /^pg_restore: from TOC entry/ { toc = $0; next }
  /^pg_restore: error:/ {
    msg = $0; sub(/^pg_restore: error: /, "", msg)
    print (toc == "" ? "pg_restore: (no TOC entry)" : toc) "\037" msg; toc = ""
  }
' "$WORKDIR/restore.err" >"$WORKDIR/restore.errors"

condition_of() {
  case "$1" in
    *"duplicate key value violates unique constraint"*) echo unique_violation ;;
    *"violates foreign key constraint"*) echo foreign_key_violation ;;
    *"violates not-null constraint"*) echo not_null_violation ;;
    *"violates check constraint"*) echo check_violation ;;
    *"invalid input syntax"*|*"invalid input value"*) echo invalid_text_representation ;;
    *"already exists"*) echo duplicate_object ;;
    *"does not exist"*) echo undefined_object ;;
    *"permission denied"*|*"must be owner"*|*"must be superuser"*) echo insufficient_privilege ;;
    *"COPY failed"*) echo copy_failed ;;
    *) echo unclassified ;;
  esac
}

UNEXPECTED=0
while IFS="$(printf '\037')" read -r toc msg; do
  [ -n "$toc$msg" ] || continue
  allowed=0
  for pat in ${RESTORE_ALLOW_LIST[@]+"${RESTORE_ALLOW_LIST[@]}"}; do
    if printf '%s' "$msg" | grep -Eq "$pat"; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    UNEXPECTED=$((UNEXPECTED + 1))
    # "from TOC entry 4242; 0 16500 TABLE DATA public candidates owner" → "TOC 4242: TABLE DATA public candidates owner"
    obj="$(printf '%s' "$toc" | sed -E 's/^pg_restore: from TOC entry ([0-9]+); [0-9]+ [0-9]+ /TOC \1: /; s/^pg_restore: //' | tr -cd '[:alnum:][:space:]_.:()-' | cut -c1-200)"
    echo "  ✗ restore error [$(condition_of "$msg")] $obj"
  fi
done <"$WORKDIR/restore.errors"

if [ "$RESTORE_RC" -ne 0 ] && [ "$UNEXPECTED" -eq 0 ] && [ ! -s "$WORKDIR/restore.errors" ]; then
  # Non-zero exit with nothing we could classify: never assume it was benign.
  echo "  ✗ pg_restore exited $RESTORE_RC without a classifiable error."
  UNEXPECTED=$((UNEXPECTED + 1))
fi
if [ "$UNEXPECTED" -gt 0 ]; then
  FINDINGS=$((FINDINGS + 1))
  REPORT_LINES+=("- ❌ **$UNEXPECTED restore error(s)** outside the allow-list (job log lists object + condition only; message text is never printed)")
else
  REPORT_LINES+=("- ✅ restore completed with no errors outside the allow-list")
fi

# ── TEST HOOK — damage the restored copy on purpose, to prove the checks below can fail ──────────
if [ -n "${DRILL_TEST_POST_RESTORE_SQL:-}" ]; then
  log "TEST HOOK: applying DRILL_TEST_POST_RESTORE_SQL to the target"
  q "$TARGET_URL" "$DRILL_TEST_POST_RESTORE_SQL" >/dev/null 2>"$WORKDIR/hook.err" \
    || die2 "test hook failed: $(head -c 300 "$WORKDIR/hook.err" | tr '\n' ' ')"
fi

# ── 5. Verify ─────────────────────────────────────────────────────────────────────────────────────
log "verifying row counts and inventory on the restored copy"
measure "$TARGET_URL" "$WORKDIR/tgt" target
compare "$WORKDIR/src" "$WORKDIR/tgt" restored

# ── 6. Report — aggregate metadata only ───────────────────────────────────────────────────────────
TOTAL_ROWS="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORKDIR/src.counts")"
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
