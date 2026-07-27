#!/usr/bin/env bash
# scripts/deploy/preflight-check.sh
#
# PURE LOCAL, credential-free readiness check for the C# prod deploy (runbook
# docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md). Safe to run
# in any sandbox: it never touches AWS, never opens a database connection, and
# never needs a secret. It only:
#   - builds Docker images locally (docker build talks to the local daemon +
#     public registries, not AWS),
#   - runs `terraform fmt -check` / `terraform validate` (local static checks,
#     no `terraform plan`/`apply`, no state, no cloud calls),
#   - checks that expected files exist,
#   - runs a local TypeScript module-graph smoke check (no network calls).
#
# Exits 0 if every check passes, non-zero (= number of failed checks) otherwise.
# Prints a PASS/FAIL line per check plus a summary.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLATFORM_DIR="$REPO_ROOT/services/Tims.Platform"
TF_DIR="$PLATFORM_DIR/deploy/terraform"
MANUAL_DIR="$REPO_ROOT/packages/db/prisma/manual"
MIGRATIONS_DIR="$PLATFORM_DIR/src/Tims.Infrastructure/Migrations"

PASS=0
FAIL=0
declare -a RESULTS=()

record() {
  local status="$1" name="$2" detail="${3:-}"
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
  RESULTS+=("$status|$name|$detail")
}

section() {
  echo
  echo "== $1 =="
}

# --- 1. Docker builds (local daemon, public registries only — no AWS) -------------

section "Docker builds"

if ! command -v docker >/dev/null 2>&1; then
  record FAIL "docker CLI present" "docker not found on PATH"
elif ! docker info >/dev/null 2>&1; then
  record FAIL "docker daemon running" "docker CLI found but daemon is not reachable (start Docker Desktop / colima)"
else
  record PASS "docker CLI + daemon" ""

  if [ -f "$PLATFORM_DIR/src/Tims.Api/Dockerfile" ]; then
    echo "Building Tims.Api image (this can take a few minutes on first run)..."
    if (cd "$PLATFORM_DIR" && docker build --platform linux/amd64 -f src/Tims.Api/Dockerfile -t tims-platform-api:preflight . >/tmp/preflight-tims-api-build.log 2>&1); then
      record PASS "docker build: Tims.Api" ""
    else
      record FAIL "docker build: Tims.Api" "see /tmp/preflight-tims-api-build.log"
    fi
  else
    record FAIL "docker build: Tims.Api" "Dockerfile not found at $PLATFORM_DIR/src/Tims.Api/Dockerfile"
  fi

  WORKERS_DOCKERFILE="$PLATFORM_DIR/src/Tims.Workers/Dockerfile"
  if [ -f "$WORKERS_DOCKERFILE" ]; then
    echo "Building Tims.Workers image..."
    if (cd "$PLATFORM_DIR" && docker build --platform linux/amd64 -f src/Tims.Workers/Dockerfile -t tims-platform-workers:preflight . >/tmp/preflight-tims-workers-build.log 2>&1); then
      record PASS "docker build: Tims.Workers" ""
    else
      record FAIL "docker build: Tims.Workers" "see /tmp/preflight-tims-workers-build.log"
    fi
  else
    record FAIL "docker build: Tims.Workers" "Dockerfile not found (expected at services/Tims.Platform/src/Tims.Workers/Dockerfile)"
  fi
fi

# --- 2. Terraform static checks (no plan/apply, no state, no cloud calls) --------

section "Terraform"

if ! command -v terraform >/dev/null 2>&1; then
  record FAIL "terraform CLI present" "terraform not found on PATH — install it to run fmt/validate locally"
else
  record PASS "terraform CLI present" "$(terraform version | head -1)"

  if [ -d "$TF_DIR" ]; then
    if terraform -chdir="$TF_DIR" fmt -check -recursive >/tmp/preflight-tf-fmt.log 2>&1; then
      record PASS "terraform fmt -check" ""
    else
      record FAIL "terraform fmt -check" "formatting drift — see /tmp/preflight-tf-fmt.log (fix with: terraform fmt -recursive $TF_DIR)"
    fi

    if terraform -chdir="$TF_DIR" init -backend=false -input=false >/tmp/preflight-tf-init.log 2>&1; then
      if terraform -chdir="$TF_DIR" validate >/tmp/preflight-tf-validate.log 2>&1; then
        record PASS "terraform validate" ""
      else
        record FAIL "terraform validate" "see /tmp/preflight-tf-validate.log"
      fi
    else
      record FAIL "terraform validate" "terraform init -backend=false failed — see /tmp/preflight-tf-init.log"
    fi
  else
    record FAIL "terraform fmt -check" "directory not found: $TF_DIR"
    record FAIL "terraform validate" "directory not found: $TF_DIR"
  fi
fi

# --- 3. EF migrations exist (runbook §1) -----------------------------------------

section "EF migrations (runbook §1)"

for mig in "20260723032952_fx_rates" "20260716000000_hris_domain"; do
  if [ -f "$MIGRATIONS_DIR/${mig}.cs" ]; then
    record PASS "EF migration: $mig" ""
  else
    record FAIL "EF migration: $mig" "not found under $MIGRATIONS_DIR"
  fi
done

# --- 4. Compliance SQL files exist (runbook §0.2) --------------------------------

section "Compliance SQL files (runbook §0.2)"

for sql in \
  "2026-07-17-data-access-logs-immutable.sql" \
  "2026-07-17-audit-logs-immutable.sql" \
  "2026-07-17-add-access-reviews.sql"
do
  if [ -f "$MANUAL_DIR/$sql" ]; then
    record PASS "compliance SQL: $sql" ""
  else
    record FAIL "compliance SQL: $sql" "not found under $MANUAL_DIR"
  fi
done

# --- 5. scripts/parity/cli.ts exists + its dependencies install/resolve cleanly --

section "scripts/parity harness"

CLI_PATH="$REPO_ROOT/scripts/parity/cli.ts"
if [ -f "$CLI_PATH" ]; then
  record PASS "scripts/parity/cli.ts exists" ""
else
  record FAIL "scripts/parity/cli.ts exists" "not found at $CLI_PATH"
fi

if ! command -v npx >/dev/null 2>&1; then
  record FAIL "parity harness deps resolve" "npx not found on PATH"
elif [ -f "$CLI_PATH" ]; then
  # Running with no args hits the USAGE early-return in cli.ts's dispatch()
  # BEFORE any config/network/Supabase call is made — so this proves the full
  # module graph (every import in cli.ts + its dependencies) resolves and
  # type-checks-enough-to-run under tsx, without needing scripts/parity/.env
  # or any credentials. Expected: exit 1 + USAGE printed to stderr.
  OUTPUT="$(cd "$REPO_ROOT" && npx tsx scripts/parity/cli.ts 2>&1)"
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 1 ] && echo "$OUTPUT" | grep -q "Usage: tsx scripts/parity/cli.ts"; then
    record PASS "parity harness deps resolve (tsx cli.ts module load)" ""
  else
    record FAIL "parity harness deps resolve (tsx cli.ts module load)" "unexpected exit=$EXIT_CODE output=$(echo "$OUTPUT" | tr '\n' ' ' | head -c 300)"
  fi
fi

# --- Summary ----------------------------------------------------------------------

section "Summary"

for r in "${RESULTS[@]}"; do
  IFS='|' read -r status name detail <<< "$r"
  if [ -n "$detail" ]; then
    printf '%-6s %s (%s)\n' "$status" "$name" "$detail"
  else
    printf '%-6s %s\n' "$status" "$name"
  fi
done

echo
echo "$PASS passed, $FAIL failed."

if [ "$FAIL" -gt 0 ]; then
  exit "$FAIL"
fi
exit 0
