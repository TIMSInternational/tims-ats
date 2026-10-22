#!/usr/bin/env bash
#
# Production schema baseline + drift detection — issue #115.
#
# WHY THIS EXISTS
# ---------------
# Four systems can mutate the production schema (Prisma migration SQL applied by hand, Prisma
# manual SQL, EF Core migrations, the Supabase dashboard/CLI). None of them is authoritative, and
# on 2026-08-02 issue #111 found RLS policies in production that existed in ZERO repo files —
# undetectable from the repo, discovered only by querying the live database.
#
# This script makes the live schema itself a reviewable, version-controlled artifact:
#
#   capture  →  pg_dump --schema-only from prod, normalised, written to the committed baseline
#   check    →  dump again, diff against the committed baseline, fail on any divergence
#
# `check` is the generalisation of `verify-rls-isolation.ts` (/gate check 14) from "are the RLS
# policies right" to "is the whole schema what we committed".
#
# EXIT CODES — the did-not-run/found-nothing distinction is the point (cf. .claude/rules/verification.md)
#   0  ran, and the live schema matches the committed baseline
#   1  ran, and found drift
#   2  COULD NOT RUN — no pg_dump of a high enough version, no connection URL, or the dump failed.
#      Exit 2 is NOT a pass. A gate that reports it as one is the #38 failure mode.
#
# USAGE
#   bash scripts/db/schema-baseline.sh capture   # refresh the baseline (review the git diff!)
#   bash scripts/db/schema-baseline.sh check     # /gate check 16
#
# Read-only against prod: pg_dump --schema-only takes no locks that block writes and never writes.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE="$REPO_ROOT/packages/db/baseline/prod-public-schema.sql"

# Only the schemas this project owns. Deliberately EXCLUDES auth/storage/realtime/vault: those are
# Supabase-managed and change under us on platform upgrades, which would make drift detection cry
# wolf until it gets ignored. supabase_migrations is included — it is our own provenance ledger.
DUMP_SCHEMAS=(-n public -n supabase_migrations)

# Marks the end of capture()'s generated header. `check` strips everything up to and including this
# line before diffing, so the header's capture timestamp is never mistaken for schema drift. It must
# be a string pg_dump itself would never emit.
HEADER_SENTINEL="-- >>> END BASELINE HEADER — everything below is verbatim pg_dump output"

die2() {
  echo "⚠ SCHEMA DRIFT CHECK DID NOT RUN — $1" >&2
  echo "  This is exit 2, not a pass. Nothing was verified." >&2
  exit 2
}

# ── Locate a pg_dump at least as new as the server ────────────────────────────────────────────────
# pg_dump refuses to dump a server newer than itself. Prod is PostgreSQL 17.x, and macOS/Homebrew
# commonly leaves an older client first on PATH (14.x here), so search explicitly.
find_pg_dump() {
  local candidates=("${PG_DUMP:-}" pg_dump)
  local v
  for v in 18 17; do
    candidates+=("/opt/homebrew/opt/postgresql@$v/bin/pg_dump" "/usr/lib/postgresql/$v/bin/pg_dump")
  done
  for c in "${candidates[@]}"; do
    [ -n "$c" ] || continue
    command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || continue
    local ver major
    ver="$("$c" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)" || continue
    major="${ver%%.*}"
    if [ -n "$major" ] && [ "$major" -ge 17 ] 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

# ── Connection URL: same resolution order as verify-rls-isolation.ts ──────────────────────────────
load_db_url() {
  if [ -z "${DIRECT_URL:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
    for f in "$REPO_ROOT/packages/db/.env" "$REPO_ROOT/.env"; do
      [ -f "$f" ] || continue
      # shellcheck disable=SC1090
      set -a; . "$f" >/dev/null 2>&1; set +a
      [ -n "${DIRECT_URL:-}${DATABASE_URL:-}" ] && break
    done
  fi
  echo "${DIRECT_URL:-${DATABASE_URL:-}}"
}

# ── Normalise a dump so the diff shows schema changes and nothing else ────────────────────────────
# pg_dump's header records both the server and client versions. The client version varies by whoever
# runs it, so stripping it is required for a stable diff; the SERVER version is recorded separately
# by capture() in the file header, where a real upgrade shows up as an intentional one-line change.
#
# pg_dump 17 also brackets its output with `\restrict <random-nonce>` / `\unrestrict <nonce>` (a psql
# meta-command guard against a malicious dump smuggling in commands). The nonce is regenerated on
# every invocation, so it must be collapsed to a placeholder or every check reports 4 lines of
# phantom drift. The guard is only meaningful when restoring; this artifact exists to be diffed.
normalise() {
  sed -e '/^-- Dumped from database version /d' \
      -e '/^-- Dumped by pg_dump version /d' \
      -e '/^-- Started on /d' \
      -e '/^-- Completed on /d' \
      -e 's/^\\restrict .*$/\\restrict <nonce-normalised>/' \
      -e 's/^\\unrestrict .*$/\\unrestrict <nonce-normalised>/' \
      -e 's/[[:space:]]*$//' \
    | cat -s
}

# ── Object-level change summary ───────────────────────────────────────────────────────────────────
# OBJECTS-ONLY MODE (#328 review): this repository is PUBLIC, so anything a CI run prints is public. In CI
# (GITHUB_ACTIONS=true) or with SCHEMA_DRIFT_OBJECTS_ONLY=1, output names changed OBJECTS only — never a
# verbatim schema line, because a function body, default or comment changed out of band could carry
# anything. Lines that name no object (columns, bodies) are counted, not echoed. Locally the full diff is
# still printed: it is the reviewer's main tool and goes nowhere public.
OBJECTS_ONLY=0
if [ "${SCHEMA_DRIFT_OBJECTS_ONLY:-}" = "1" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then OBJECTS_ONLY=1; fi

OBJ_MARK='@@obj@@ '
# annotate_statements FILE → each line prefixed "T|" (top-level statement text) or "B|<object>|" (inside a
# single-quoted literal or a dollar-quoted body that began on an earlier line), where <object> is the most
# recent top-level CREATE <kind> <name> (identifier characters only). POSIX awk; nothing here is printed by
# object_summary except the strict object names.
annotate_statements() {
  awk '
    BEGIN { inq = 0; indq = 0; indol = 0; tag = ""; obj = "?" }
    {
      line = $0
      body = (inq || indol)
      if (!body && match(line, /^[[:space:]]*CREATE (OR REPLACE )?(UNIQUE )?(FUNCTION|PROCEDURE|TRIGGER|VIEW|MATERIALIZED VIEW|TABLE|INDEX|POLICY|RULE|TYPE|DOMAIN|AGGREGATE) [A-Za-z0-9_."]+/)) {
        head = substr(line, RSTART, RLENGTH)
        sub(/^[[:space:]]*CREATE /, "", head); sub(/^OR REPLACE /, "", head); sub(/^UNIQUE /, "", head)
        obj = substr(head, 1, 160)
      }
      i = 1; L = length(line)
      while (i <= L) {
        if (indol) {
          p = index(substr(line, i), tag)
          if (p == 0) break
          indol = 0; i += p - 1 + length(tag); continue
        }
        if (indq) {
          # Inside a double-quoted identifier: an apostrophe or a $ here is part of the name.
          p = index(substr(line, i), "\042")
          if (p == 0) { i = L + 1; break }
          i += p
          if (substr(line, i, 1) == "\042") { i++; continue }
          indq = 0; continue
        }
        if (inq) {
          p = index(substr(line, i), "\047")
          if (p == 0) break
          i += p
          if (substr(line, i, 1) == "\047") { i++; continue }
          inq = 0; continue
        }
        c = substr(line, i, 1)
        if (c == "\047") { inq = 1; i++; continue }
        if (c == "\042") { indq = 1; i++; continue }
        if (c == "-" && substr(line, i + 1, 1) == "-") break
        if (c == "$") {
          rest = substr(line, i)
          if (match(rest, /^\$[A-Za-z_]*\$/)) { tag = substr(rest, 1, RLENGTH); indol = 1; i += RLENGTH; continue }
        }
        i++
      }
      if (body) print "B|" obj "|" line; else print "T|" line
    }' "$1"
}

# object_summary OLD NEW → one "± <object>" line per changed object line; in OBJECTS_ONLY mode other
# changed lines are dropped and only counted.
object_summary() {
  if [ "$OBJECTS_ONLY" = "1" ]; then
    # Statement-aware (tier-1 review): every dump line is first classified by annotate_statements as
    # top-level (T|) or as text INSIDE a quoted literal / dollar-quoted body (B|<enclosing object>|). Only
    # top-level lines are mapped to object names; a body line is never printed, even if it starts with
    # "CREATE TABLE ...", and a body-only change is reported by its enclosing object's name.
    local d names bodies total shown
    d="$(diff -U0 <(annotate_statements "$1") <(annotate_statements "$2") | grep -E '^[+-][^+-]' || true)"
    names="$(printf '%s\n' "$d" | sed -nE \
      -e "s/^([+-])T\\|[[:space:]]*(CREATE TABLE [a-zA-Z0-9_.\"]+).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(CREATE (UNIQUE )?INDEX [a-zA-Z0-9_.\"]+).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(CREATE POLICY [a-zA-Z0-9_.\"]+ ON [a-zA-Z0-9_.\"]+).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(ALTER TABLE [a-zA-Z0-9_.\"]+ (ENABLE|FORCE|DISABLE|NO FORCE) ROW LEVEL SECURITY).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(GRANT [A-Za-z, ]+ ON [a-zA-Z0-9_.\"]+ TO [a-zA-Z0-9_\"]+).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(ADD CONSTRAINT [a-zA-Z0-9_.\"]+).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(CREATE FUNCTION [a-zA-Z0-9_.\"]+).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(CREATE TRIGGER [a-zA-Z0-9_.\"]+).*/\1 \2/p" \
      -e 't' \
      -e "s/^([+-])T\\|[[:space:]]*(ALTER TABLE (ONLY )?[a-zA-Z0-9_.\"]+).*/\1 \2 (altered)/p" || true)"
    bodies="$(printf '%s\n' "$d" | sed -nE 's/^[+-]B\|([^|]*)\|.*/~ \1 (body changed)/p' | sort -u || true)"
    [ -n "$names" ] && printf '%s\n' "$names" | head -60
    [ -n "$bodies" ] && printf '%s\n' "$bodies" | head -60
    total="$(printf '%s\n' "$d" | grep -c . || true)"
    shown="$(printf '%s\n' "$names" | grep -c . || true)"
    echo "  (+ $((total - shown)) changed line(s) inside object bodies — not printed: objects-only mode)"
    return 0
  fi
  local mapped
  mapped="$(diff -U0 "$1" "$2" \
    | grep -E '^[+-][^+-]' \
    | sed -E "s/^([+-])[[:space:]]*(CREATE TABLE [a-zA-Z0-9_.\"]+).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(CREATE (UNIQUE )?INDEX [a-zA-Z0-9_.\"]+).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(CREATE POLICY [a-zA-Z0-9_.\"]+ ON [a-zA-Z0-9_.\"]+).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(ALTER TABLE [a-zA-Z0-9_.\"]+ (ENABLE|FORCE|DISABLE|NO FORCE) ROW LEVEL SECURITY).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(GRANT [A-Za-z, ]+ ON [a-zA-Z0-9_.\"]+ TO [a-zA-Z0-9_\"]+).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(ADD CONSTRAINT [a-zA-Z0-9_.\"]+).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(CREATE FUNCTION [a-zA-Z0-9_.\"]+).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(CREATE TRIGGER [a-zA-Z0-9_.\"]+).*/${OBJ_MARK}\1 \2/;
              t
              s/^([+-])[[:space:]]*(ALTER TABLE (ONLY )?[a-zA-Z0-9_.\"]+).*/${OBJ_MARK}\1 \2 (altered)/" || true)"
    printf '%s\n' "$mapped" | sed "s/^${OBJ_MARK}//" | head -60
}

# NOTE ON CREDENTIAL EXPOSURE: pg_dump takes its connection string as an argv, so the URL — password
# included — is visible in `ps` to other processes of the same user for the duration of the dump.
# pg_dump offers no stdin/file alternative for a URI; avoiding it would mean parsing the URL into
# PGHOST/PGUSER/PGPASSWORD, which is its own fragile failure mode. Accepted on a developer machine, where
# the URL already sits in packages/db/.env.
# CI DECISION (#124, 2026-10-01): check 16 runs nightly (.github/workflows/nightly-db-controls.yml) and kept
# the argv form. The runner is an ephemeral single-tenant VM running only this job's own processes, the URL
# is the read-only `ci_readonly` credential (verify-full, from a main-only environment), and GitHub masks the
# secret in logs. Converting to PG* variables was judged not worth a second URL parser in a security check.
dump_live() {
  local url="$1" out="$2" pgd="$3"
  # --no-owner/--no-acl-less: ownership and grants are part of the security surface (#111 was a
  # policy bug; a missing GRANT is the same class), so they ARE dumped. --no-comments is off for
  # the same reason. Only the noisy, environment-dependent bits are excluded.
  "$pgd" --schema-only --no-publications --no-subscriptions \
    "${DUMP_SCHEMAS[@]}" --dbname "$url" >"$out" 2>"$out.err"
}

cmd="${1:-check}"

PG_DUMP_BIN="$(find_pg_dump)" || die2 "no pg_dump >= 17 found (prod is PostgreSQL 17.x; pg_dump refuses to dump a newer server).
  macOS:  brew install postgresql@17
  Linux:  apt-get install postgresql-client-17
  Or set PG_DUMP=/path/to/pg_dump."

DB_URL="$(load_db_url)"
[ -n "$DB_URL" ] || die2 "no DIRECT_URL or DATABASE_URL in the environment or packages/db/.env.
  Run: bash scripts/dev/setup-db-env.sh   (issue #41)"

# Validate the local side before dumping prod: a missing or headerless baseline is a local problem,
# and reporting it as a connection failure sends the reader looking in the wrong place.
HEADER_END=""
if [ "${1:-check}" = "check" ]; then
  [ -f "$BASELINE" ] || die2 "no committed baseline at ${BASELINE#"$REPO_ROOT"/}.
  Create one: bash scripts/db/schema-baseline.sh capture"
  HEADER_END="$(awk -v s="$HEADER_SENTINEL" '$0 == s { print NR; exit }' "$BASELINE")"
  [ -n "$HEADER_END" ] || die2 "the committed baseline has no header sentinel — it predates this script version.
  Re-capture it: bash scripts/db/schema-baseline.sh capture"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! dump_live "$DB_URL" "$TMP/live.sql" "$PG_DUMP_BIN"; then
  die2 "pg_dump failed:
$(sed 's/^/    /' "$TMP/live.sql.err" 2>/dev/null | head -20)"
fi
[ -s "$TMP/live.sql" ] || die2 "pg_dump produced an empty dump — refusing to treat that as 'no drift'."

SERVER_VERSION="$(grep -m1 '^-- Dumped from database version ' "$TMP/live.sql" | sed 's/^-- Dumped from database version //')"
normalise <"$TMP/live.sql" >"$TMP/live.norm.sql"

case "$cmd" in
  capture)
    mkdir -p "$(dirname "$BASELINE")"

    # Capture the OLD body before overwriting, so the summary below can diff old-vs-new. Doing this
    # via git after the write would also pick up the header's capture timestamp, which changes on
    # every run and made an unchanged schema report "1 line changed".
    PREV_BODY="$TMP/prev.norm.sql"
    : >"$PREV_BODY"
    if [ -f "$BASELINE" ]; then
      prev_end="$(awk -v s="$HEADER_SENTINEL" '$0 == s { print NR; exit }' "$BASELINE")"
      if [ -n "$prev_end" ]; then
        tail -n "+$((prev_end + 1))" "$BASELINE" | normalise >"$PREV_BODY"
      fi
    fi
    {
      echo "-- TIMS ATS — production schema baseline (issue #115)"
      echo "--"
      echo "-- Captured:        $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      echo "-- Server version:  ${SERVER_VERSION:-unknown}"
      echo "-- Schemas:         public, supabase_migrations"
      echo "-- Command:         bash scripts/db/schema-baseline.sh capture"
      echo "--"
      echo "-- This file is GROUND TRUTH for what production actually looks like — not what the"
      echo "-- migrations say it should look like. #111 proved those are different things."
      echo "-- Regenerate with 'capture' and review the git diff; 'check' fails CI on divergence."
      echo "$HEADER_SENTINEL"
      cat "$TMP/live.norm.sql"
    } >"$BASELINE"
    echo "✓ Baseline written: ${BASELINE#"$REPO_ROOT"/}"
    echo "  Server: ${SERVER_VERSION:-unknown}  |  $(wc -l <"$BASELINE" | tr -d ' ') lines"

    # An 8,000-line generated file is not reviewable by eyeballing, and "review the diff" is the only
    # thing standing between this control and a rubber stamp (ddl-governance.md §5). So summarise the
    # change at OBJECT level: turn "read 8,781 lines" into "read six". Compares the new dump against
    # the PREVIOUS baseline body — not via git — so the header's capture timestamp cannot register as
    # a change, and so this works on an unstaged or non-git checkout too.
    if diff -q "$PREV_BODY" "$TMP/live.norm.sql" >/dev/null 2>&1; then
      echo "  No schema change vs the previous baseline (only the capture timestamp moved)."
    else
      echo
      echo "  ── What changed vs the previous baseline ───────────────────────────────────"
      object_summary "$PREV_BODY" "$TMP/live.norm.sql" | sed 's/^/  /'
      added=$(diff -U0 "$PREV_BODY" "$TMP/live.norm.sql" | grep -cE '^\+[^+]' || true)
      removed=$(diff -U0 "$PREV_BODY" "$TMP/live.norm.sql" | grep -cE '^-[^-]' || true)
      echo "  ───────────────────────────────────────────────────────────────────────────"
      echo "  (+$added / -$removed changed lines; showing up to 60)"
      echo
      echo "  Every line above is a real production change. If one is NOT explained by this PR,"
      echo "  STOP — see docs/architecture/ddl-governance.md §7."
    fi
    ;;

  check)
    # Strip capture()'s generated header (up to and including the sentinel) so its timestamp and
    # server-version lines cannot masquerade as schema drift. $HEADER_END was located and validated
    # before the dump, by exact string match: the sentinel contains regex metacharacters and a
    # leading '--', both of which make sed/grep patterns unsafe here.
    tail -n "+$((HEADER_END + 1))" "$BASELINE" | normalise >"$TMP/base.norm.sql"

    if diff -u "$TMP/base.norm.sql" "$TMP/live.norm.sql" >"$TMP/drift.diff"; then
      echo "✓ Live schema matches the committed baseline (public, supabase_migrations)."
      echo "  Server: ${SERVER_VERSION:-unknown}"
      exit 0
    fi

    echo "✖ SCHEMA DRIFT: production no longer matches the committed baseline." >&2
    echo >&2
    total=$(grep -cE '^[+-][^+-]' "$TMP/drift.diff")
    if [ "$OBJECTS_ONLY" = "1" ]; then
      echo "  Changed objects (objects-only mode — run 'check' locally for the full diff):" >&2
      object_summary "$TMP/base.norm.sql" "$TMP/live.norm.sql" | sed 's/^/  /' >&2
      echo >&2
      echo "  ($total changed line(s) in total)" >&2
    else
      sed -n '3,203p' "$TMP/drift.diff" >&2
      echo >&2
      echo "  ($total changed line(s); showing the first 200 of the diff)" >&2
    fi
    cat >&2 <<'EOF'

Every hunk is a production change that no committed file explains, OR a committed change that has
not been captured. Both need resolving before merge:

  - Change was intentional and is already applied to prod
        → bash scripts/db/schema-baseline.sh capture, and commit the new baseline in this PR.
  - Change is NOT explained by anything in this PR
        → STOP. Something mutated prod out of band. This is the #111 scenario.
          Check supabase_migrations.schema_migrations and __EFMigrationsHistory for provenance,
          then see docs/architecture/ddl-governance.md.
EOF
    exit 1
    ;;

  *)
    echo "usage: $0 {capture|check}" >&2
    exit 2
    ;;
esac
