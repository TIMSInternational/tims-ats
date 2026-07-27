#!/usr/bin/env bash
# scripts/deploy/apply-compliance-sql.sh
#
# Wraps runbook §0.2 (docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md):
#
#   psql -v ON_ERROR_STOP=1 --single-transaction "<DIRECT_PROD_URL>" -f <file>
#
# applied, IN ORDER, to the 3 pending compliance SQL files:
#   CB-1  packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql
#   CB-1b packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql
#   CB-2b packages/db/prisma/manual/2026-07-17-add-access-reviews.sql
#
# Each file is applied in ITS OWN `--single-transaction` psql invocation (matching
# each file's own header comment / the runbook), so a failure partway through file
# 2 cannot leave file 1's (already-committed) change half-applied, and does not
# retroactively affect file 1. Files are NOT chained into one giant transaction —
# that would contradict the runbook, which invokes psql separately per file.
#
# SAFETY MODEL:
#   - Dry-run by default: prints the exact psql commands (with the connection
#     string REDACTED) and the post-apply verification statements, does not
#     open a real connection.
#   - Real execution requires BOTH: the DIRECT_PROD_URL env var set, AND the
#     explicit --yes flag.
#   - This script never accepts a connection string as a CLI argument (it would
#     leak into shell history / process listings) — env var only. Critically,
#     it ALSO never passes DIRECT_PROD_URL as a positional argument to `psql`
#     itself: `psql "$DIRECT_PROD_URL"` would put the full connection string —
#     including the embedded password — into that subprocess's argv, which is
#     visible to any other user on the host via `ps aux`/`ps -ef` regardless of
#     how the value originally reached this script. Instead, DIRECT_PROD_URL is
#     parsed (in-process, via a Python parser fed the URL over its inherited
#     environment, never as its own argv either) into discrete PG* environment
#     variables (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/...) that libpq reads
#     natively, and `psql` is invoked with NO connection-string argument at all.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MANUAL_DIR="$REPO_ROOT/packages/db/prisma/manual"

DRY_RUN=1
YES=0

# Ordered: CB-1, CB-1b, CB-2b (runbook §0.2's own order).
FILES=(
  "2026-07-17-data-access-logs-immutable.sql"
  "2026-07-17-audit-logs-immutable.sql"
  "2026-07-17-add-access-reviews.sql"
)

# Post-apply verification per file. The first two install an ENABLE ALWAYS
# append-only trigger that RAISEs on UPDATE/DELETE/TRUNCATE (see each file's own
# header) — verifying that requires actually attempting a forbidden write, which
# this script does NOT do automatically (that would mutate/attempt-to-mutate a
# real audit table from an unattended script — too dangerous to automate). It
# prints the exact manual verification command instead. The third file
# (CB-2b) only creates a table + RLS policy, no append-only trigger, so its
# verification is a plain read-only introspection query this script CAN run.
#
# Implemented as a case statement, NOT `declare -A` (bash 4+ associative
# arrays): macOS ships /bin/bash 3.2 (Apple froze it pre-GPLv3) with no
# associative-array support, and this script must run there unmodified.
verify_instructions_for() {
  case "$1" in
    "2026-07-17-data-access-logs-immutable.sql")
      cat <<'EOF'
MANUAL verification required (do NOT script an actual destructive attempt against prod without a wrapping transaction you intend to roll back):
    BEGIN;
    DELETE FROM "data_access_logs" WHERE false; -- expect: ERROR 42501 "data_access_logs is append-only: DELETE is not permitted"
    ROLLBACK;
EOF
      ;;
    "2026-07-17-audit-logs-immutable.sql")
      cat <<'EOF'
MANUAL verification required (same pattern as data_access_logs):
    BEGIN;
    DELETE FROM "audit_logs" WHERE false; -- expect: ERROR 42501 "audit_logs is append-only: DELETE is not permitted"
    ROLLBACK;
EOF
      ;;
    "2026-07-17-add-access-reviews.sql")
      cat <<'EOF'
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'access_reviews'; -- expect: t | t (RLS enabled + forced)
EOF
      ;;
    *)
      echo "(no verification instruction registered for $1)"
      ;;
  esac
}

# Parses $DIRECT_PROD_URL into discrete PG* environment variables (PGHOST, PGPORT,
# PGUSER, PGPASSWORD, PGDATABASE, and any query-string params such as sslmode) and
# `export`s them into THIS shell, then unsets DIRECT_PROD_URL itself. After this
# runs, `psql` (with no positional connection-string argument) will pick up the
# connection entirely from the environment — libpq's documented behavior when no
# conninfo argument is given. This is what keeps the connection string (and its
# embedded password) out of `psql`'s argv, and therefore out of `ps aux`/`ps -ef`.
#
# The URL is handed to python3 via the inherited environment (os.environ), never
# as a python3 CLI argument, so it does not appear in python3's argv either.
PG_ENV_VAR_NAMES=()
load_pg_env_from_direct_prod_url() {
  local parsed
  if ! parsed="$(python3 - <<'PYEOF'
import os
import shlex
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

url = os.environ.get("DIRECT_PROD_URL", "")
if not url:
    print("DIRECT_PROD_URL is empty", file=sys.stderr)
    raise SystemExit(1)

parts = urlsplit(url)
if parts.scheme not in ("postgres", "postgresql"):
    print(f"unsupported scheme {parts.scheme!r} (expected postgres:// or postgresql://)", file=sys.stderr)
    raise SystemExit(1)

env = {}
if parts.hostname:
    env["PGHOST"] = parts.hostname
if parts.port:
    env["PGPORT"] = str(parts.port)
if parts.username:
    env["PGUSER"] = unquote(parts.username)
if parts.password:
    env["PGPASSWORD"] = unquote(parts.password)
db = parts.path.lstrip("/")
if db:
    env["PGDATABASE"] = unquote(db)
for key, value in parse_qsl(parts.query, keep_blank_values=True):
    env[f"PG{key.upper()}"] = value

for k, v in env.items():
    print(f"export {k}={shlex.quote(v)}")
PYEOF
  )"; then
    echo "ERROR: failed to parse DIRECT_PROD_URL (expected a postgres:// or postgresql:// URL)." >&2
    exit 1
  fi
  # Track exported var names so we can unset them again once psql is done.
  # (No negative array indices here — macOS ships /bin/bash 3.2, which lacks them;
  # see the FILES/verify_instructions_for comment above for the same constraint.)
  local line rest name
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    rest="${line#export }"
    name="${rest%%=*}"
    PG_ENV_VAR_NAMES+=("$name")
  done <<< "$parsed"
  eval "$parsed"
  unset DIRECT_PROD_URL
}

unset_pg_env() {
  local name
  for name in "${PG_ENV_VAR_NAMES[@]}"; do
    unset "$name"
  done
}

usage() {
  cat <<'EOF'
Usage: DIRECT_PROD_URL=<url> scripts/deploy/apply-compliance-sql.sh [options]

Applies the 3 pending compliance SQL files (runbook §0.2) to prod Postgres,
in order, each in its own --single-transaction psql invocation.

Options:
  --yes          Actually connect and apply. Without this flag, the script
                 only prints the commands it would run and exits 0.
  --dry-run      Explicit no-op mode (this is also the default).
  -h, --help     Show this help.

Requires:
  DIRECT_PROD_URL   Direct (non-pooled, port 5432) Postgres connection string
                     for prod. Required for --yes; ignored (only checked for
                     presence, never printed) in dry-run.

Examples:
  # Safe default — just shows the plan, no env var needed:
  scripts/deploy/apply-compliance-sql.sh

  # Federico, for real:
  DIRECT_PROD_URL='postgres://...' scripts/deploy/apply-compliance-sql.sh --yes
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; DRY_RUN=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

echo "== Compliance SQL apply (runbook §0.2) =="
echo "  mode: $([ "$DRY_RUN" -eq 1 ] && echo 'DRY RUN (no connection made)' || echo 'REAL RUN')"
echo "  files, in order:"
for f in "${FILES[@]}"; do
  echo "    - $f"
done
echo

for f in "${FILES[@]}"; do
  if [ ! -f "$MANUAL_DIR/$f" ]; then
    echo "ERROR: expected compliance SQL file not found: $MANUAL_DIR/$f" >&2
    exit 1
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Commands that would run (connection string redacted below; never printed for real;"
  echo "and never passed as a psql argument for real either — see below):"
  echo
  echo "  # DIRECT_PROD_URL is parsed into PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/... env"
  echo "  # vars first (never printed), so it never appears on psql's command line / in ps aux:"
  for f in "${FILES[@]}"; do
    echo "  psql -v ON_ERROR_STOP=1 --single-transaction -f $MANUAL_DIR/$f"
    echo "  # verify:"
    verify_instructions_for "$f" | sed 's/^/  #   /'
    echo
  done
  echo "Dry run complete. No database connection was opened."
  echo "Re-run with DIRECT_PROD_URL set and --yes to execute for real."
  exit 0
fi

if [ "$YES" -ne 1 ]; then
  echo "ERROR: refusing to execute without --yes." >&2
  exit 1
fi

if [ -z "${DIRECT_PROD_URL:-}" ]; then
  echo "ERROR: DIRECT_PROD_URL is not set. Refusing to proceed — this script" >&2
  echo "       never accepts a connection string as a CLI argument (shell" >&2
  echo "       history / process-list leakage), only via this env var." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found on PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found on PATH (needed to parse DIRECT_PROD_URL without ever" >&2
  echo "       putting it on a subprocess's command line)." >&2
  exit 1
fi

load_pg_env_from_direct_prod_url
trap unset_pg_env EXIT

for f in "${FILES[@]}"; do
  echo
  echo "-- Applying $f (own transaction) --"
  # No connection-string argument here on purpose — psql reads PGHOST/PGPORT/PGUSER/
  # PGPASSWORD/PGDATABASE/... from the environment set by load_pg_env_from_direct_prod_url
  # above, so the secret never appears in this (or any) process's argv / `ps aux`.
  psql -v ON_ERROR_STOP=1 --single-transaction -f "$MANUAL_DIR/$f"
  echo "Applied $f."
  echo "Verification for $f:"
  verify_instructions_for "$f" | sed 's/^/  /'
done

echo
echo "All 3 compliance SQL files applied. Run the verification statements above"
echo "(manually, for the append-only triggers) before signing off runbook §0.2."
