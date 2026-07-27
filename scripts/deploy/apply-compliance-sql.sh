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
#     leak into shell history / process listings) — env var only.

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
  echo "Commands that would run (connection string redacted below; never printed for real):"
  echo
  for f in "${FILES[@]}"; do
    echo "  psql -v ON_ERROR_STOP=1 --single-transaction \"\$DIRECT_PROD_URL\" -f $MANUAL_DIR/$f"
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

for f in "${FILES[@]}"; do
  echo
  echo "-- Applying $f (own transaction) --"
  psql -v ON_ERROR_STOP=1 --single-transaction "$DIRECT_PROD_URL" -f "$MANUAL_DIR/$f"
  echo "Applied $f."
  echo "Verification for $f:"
  verify_instructions_for "$f" | sed 's/^/  /'
done

echo
echo "All 3 compliance SQL files applied. Run the verification statements above"
echo "(manually, for the append-only triggers) before signing off runbook §0.2."
