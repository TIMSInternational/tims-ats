#!/usr/bin/env bash
#
# Refuse Prisma schema-mutating commands against a non-local database — issue #115.
#
# WHY
# ---
# `prisma db push` is the documented post-clone bootstrap step (CLAUDE.md:32, README.md) and is how
# ~100 of the 102 Prisma tables were created. But production has drifted from the datamodel, so
# pointed at prod TODAY it generates:
#
#   DROP TABLE  x17   all four hris_* tables, fx_rates, all eleven qrtz_* (the live Quartz job
#                     store), and __EFMigrationsHistory itself — destroying EF's only baseline
#   DROP COLUMN  x1   nine_box_evaluations.updated_at
#   DROP CONSTRAINT x16   including all 7 hire_predictions foreign keys
#   ALTER COLUMN id DROP DEFAULT x6
#
# Measured, not hypothesised — see docs/architecture/ddl-reconciliation-2026-08-03.md §4.
#
# WHAT THIS IS NOT
# ----------------
# This is a guard against the accident, not a proof of safety. A raw
# `npx prisma db push --url <prod>` bypasses it entirely, because it never reads the env vars this
# script inspects. The real backstop is `/gate` check 16 (schema drift) plus a database backup.
# Do not treat a passing guard as permission — see docs/architecture/ddl-governance.md §3.
#
# USAGE — wraps the mutating pnpm scripts in packages/db/package.json:
#   bash scripts/db/guard-prod-ddl.sh prisma db push
#   bash scripts/db/guard-prod-ddl.sh prisma migrate dev
#
# Exit 0 → target is local, the wrapped command runs.
# Exit 1 → target is not local, or could not be determined. Fails CLOSED: an unparseable URL is
#          refused rather than assumed safe.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Only these commands mutate the schema. `generate`, `studio`, `migrate diff` etc. are read-only and
# pass through untouched, so this can wrap the whole prisma CLI without getting in the way.
is_mutating() {
  local joined="$*"
  case "$joined" in
    *"db push"*|*"db execute"*|*"migrate dev"*|*"migrate deploy"*|*"migrate reset"*|*"db seed"*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_mutating "$@"; then
  exec "$@"
fi

# Same resolution order as the rest of the tooling. db push writes to DATABASE_URL, but honours
# directUrl for DDL, so BOTH have to be local — checking only one leaves the real target unguarded.
if [ -z "${DATABASE_URL:-}${DIRECT_URL:-}" ]; then
  for f in "$REPO_ROOT/packages/db/.env" "$REPO_ROOT/.env"; do
    [ -f "$f" ] || continue
    # shellcheck disable=SC1090
    set -a; . "$f" >/dev/null 2>&1; set +a
    [ -n "${DATABASE_URL:-}${DIRECT_URL:-}" ] && break
  done
fi

host_of() {
  # postgresql://user:pass@HOST:PORT/db?params  → HOST. Tolerates absent credentials and ports.
  printf '%s' "$1" | sed -E 's#^[a-zA-Z+]+://##; s#^[^@/]*@##; s#[:/?].*$##'
}

is_local_host() {
  case "$1" in
    localhost|127.0.0.1|0.0.0.0|::1|"[::1]"|*.localhost|host.docker.internal|db|postgres) return 0 ;;
    *) return 1 ;;
  esac
}

refuse() {
  cat >&2 <<EOF
⛔ REFUSED: $* against a non-local database.

  DATABASE_URL host: ${DB_HOST:-<unset>}
  DIRECT_URL   host: ${DIRECT_HOST:-<unset>}

Production has drifted from the Prisma datamodel. This command would currently DROP 17 tables
(every hris_* table, fx_rates, all eleven qrtz_*, and __EFMigrationsHistory), one column, 16
constraints and 6 defaults. See docs/architecture/ddl-reconciliation-2026-08-03.md §4.

Prisma Migrate is formally unused in production (docs/architecture/ddl-governance.md §3).
Schema changes reach prod as reviewed SQL applied via psql, or as an EF migration.

To inspect the damage WITHOUT applying it:
  cd packages/db && npx prisma migrate diff \\
    --from-url "\$DIRECT_URL" --to-schema-datamodel prisma/schema --script

If you genuinely need this against a remote dev/branch database, run the prisma CLI directly —
this guard covers the pnpm scripts, deliberately not every possible invocation.
EOF
  exit 1
}

DB_HOST=""; DIRECT_HOST=""
[ -n "${DATABASE_URL:-}" ] && DB_HOST="$(host_of "$DATABASE_URL")"
[ -n "${DIRECT_URL:-}" ] && DIRECT_HOST="$(host_of "$DIRECT_URL")"

# Fail closed: no URL at all means we cannot prove the target is local.
if [ -z "$DB_HOST" ] && [ -z "$DIRECT_HOST" ]; then
  echo "⛔ REFUSED: no DATABASE_URL or DIRECT_URL found, so the target cannot be shown to be local." >&2
  echo "   Refusing $* rather than assuming it is safe." >&2
  exit 1
fi

for h in "$DB_HOST" "$DIRECT_HOST"; do
  [ -n "$h" ] || continue
  is_local_host "$h" || refuse "$@"
done

echo "✓ guard-prod-ddl: target is local (${DB_HOST:-$DIRECT_HOST}) — running: $*"
exec "$@"
