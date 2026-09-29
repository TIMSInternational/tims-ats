#!/usr/bin/env bash
#
# Local end-to-end proof of run-drill.sh against two throwaway supabase/postgres containers.
# Never touches production or any Supabase project. Needs Docker and a PostgreSQL >= 17 client.
#
#   bash scripts/backup-drill/local-e2e.sh
#
# Scenarios and the exit code each MUST produce:
#   1. clean drill                                   → 0
#   2. a row deleted from the restored copy          → 1   (row-count mismatch)
#   3. a policy dropped from the restored copy       → 1   (inventory mismatch)
#   4. source host unreachable                       → 2
#   5. source role WITHOUT BYPASSRLS                 → 2
#   6. a function body replaced on the restored copy → 1   (function definition mismatch)
#   7. a trigger disabled on the restored copy       → 1   (trigger enabled-state mismatch)
#   8. target URL redirected with ?hostaddr=         → 2   (refused before any connection)
#   9. target is the source cluster itself           → 2   (refused before any destructive statement)
# Plus: no synthetic PII value appears in any drill output, and no dump file is left behind.
#
# Exits 0 only if every scenario produced its expected code.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${DRILL_IMAGE:-supabase/postgres:17.6.1.178}"   # keep in sync with backup-restore-drill.yml
SRC_PORT="${E2E_SRC_PORT:-55432}"
TGT_PORT="${E2E_TGT_PORT:-55433}"
SRC_NAME="backup-drill-e2e-source"
TGT_NAME="backup-drill-e2e-target"
# Throwaway credentials for containers bound to 127.0.0.1 that live for the length of this script.
ADMIN_PW="e2e-$(date +%s)-$$"
DRILL_PW="e2e-drill-reader-password-$(date +%s)-$$-padding"

PSQL=""
for c in "${DRILL_PG_BIN:+$DRILL_PG_BIN/psql}" /usr/lib/postgresql/17/bin/psql /opt/homebrew/opt/postgresql@17/bin/psql psql; do
  [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 || continue
  v="$("$c" --version | grep -oE '[0-9]+' | head -1)"
  if [ "$v" -ge 17 ]; then PSQL="$c"; break; fi
done
[ -n "$PSQL" ] || { echo "need psql >= 17" >&2; exit 2; }

OUT="$(mktemp -d "${TMPDIR:-/tmp}/backup-drill-e2e.XXXXXX")"
cleanup() {
  docker rm -f "$SRC_NAME" "$TGT_NAME" >/dev/null 2>&1
  rm -rf "$OUT"
}
trap cleanup EXIT

start() { # name port
  docker rm -f "$1" >/dev/null 2>&1
  docker run -d --name "$1" -e POSTGRES_PASSWORD="$ADMIN_PW" -p "127.0.0.1:$2:5432" "$IMAGE" >/dev/null || exit 2
}
ready() { # port
  local i
  for i in $(seq 1 90); do
    PGPASSWORD="$ADMIN_PW" "$PSQL" -X -At -h 127.0.0.1 -p "$1" -U supabase_admin -d postgres -c 'select 1' >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "container on :$1 never became ready" >&2
  exit 2
}
as() { # user port [psql args...]
  local u="$1" p="$2"; shift 2
  PGPASSWORD="$ADMIN_PW" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$p" -U "$u" -d postgres "$@"
}
fresh_target() {
  start "$TGT_NAME" "$TGT_PORT"
  ready "$TGT_PORT"
}

echo "== starting source + target ($IMAGE)"
start "$SRC_NAME" "$SRC_PORT"
start "$TGT_NAME" "$TGT_PORT"
ready "$SRC_PORT"
ready "$TGT_PORT"

echo "== populating the synthetic source"
as supabase_admin "$SRC_PORT" -c "INSERT INTO auth.users (instance_id, id, aud, role, email, created_at) VALUES ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'auth-user@synthetic.example.test', now())" || exit 2
as postgres "$SRC_PORT" -f "$REPO_ROOT/scripts/backup-drill/fixtures/synthetic-source.sql" || exit 2
as postgres "$SRC_PORT" -c "UPDATE public.candidates SET user_id = '11111111-1111-4111-8111-111111111111' WHERE ctid = (SELECT ctid FROM public.candidates LIMIT 1)" || exit 2

echo "== creating backup_drill_reader with create-drill-role.sql (as postgres, like production)"
as postgres "$SRC_PORT" -v password="$DRILL_PW" -f "$REPO_ROOT/scripts/backup-drill/create-drill-role.sql" || exit 2
# A negative-control role: same grants, NO BYPASSRLS.
as postgres "$SRC_PORT" -c "CREATE ROLE drill_no_bypass LOGIN PASSWORD '$DRILL_PW' IN ROLE pg_read_all_data" || exit 2

SRC_URL="postgresql://backup_drill_reader:$DRILL_PW@127.0.0.1:$SRC_PORT/postgres"
TGT_URL="postgresql://supabase_admin:$ADMIN_PW@127.0.0.1:$TGT_PORT/postgres"

FAILED=0
scenario() { # label expected-exit [env assignments...]
  local label="$1" expected="$2"; shift 2
  local log="$OUT/$(echo "$label" | tr ' ' '-').log"
  env DRILL_SOURCE_SSLMODE=disable GITHUB_STEP_SUMMARY="$OUT/summary.md" \
      DRILL_TARGET_URL="$TGT_URL" DRILL_SOURCE_URL="$SRC_URL" "$@" \
      bash "$REPO_ROOT/scripts/backup-drill/run-drill.sh" >"$log" 2>&1
  local rc=$?
  if [ "$rc" -eq "$expected" ]; then
    echo "  PASS  [$label] exit $rc (expected $expected)"
  else
    echo "  FAIL  [$label] exit $rc (expected $expected)"; FAILED=1
  fi
  sed 's/^/        | /' "$log"
}

echo "== scenario 1: clean drill"
scenario "clean" 0

echo "== scenario 2: restored copy lost a row"
fresh_target
scenario "row deleted" 1 DRILL_TEST_POST_RESTORE_SQL="DELETE FROM public.candidates WHERE ctid = (SELECT ctid FROM public.candidates LIMIT 1)"

echo "== scenario 3: restored copy lost an RLS policy"
fresh_target
scenario "policy dropped" 1 DRILL_TEST_POST_RESTORE_SQL="DROP POLICY own_profile ON public.candidates"

echo "== scenario 4: source unreachable"
fresh_target
scenario "unreachable" 2 DRILL_SOURCE_URL="postgresql://backup_drill_reader:x@127.0.0.1:1/postgres"

echo "== scenario 5: source role without BYPASSRLS"
scenario "no bypassrls" 2 DRILL_SOURCE_URL="postgresql://drill_no_bypass:$DRILL_PW@127.0.0.1:$SRC_PORT/postgres"

echo "== scenario 6: restored copy has a tampered function body (same name + args)"
fresh_target
scenario "function tampered" 1 DRILL_TEST_POST_RESTORE_SQL="CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RETURN NEW; END \$\$"

echo "== scenario 7: restored copy has a disabled trigger"
fresh_target
scenario "trigger disabled" 1 DRILL_TEST_POST_RESTORE_SQL="ALTER TABLE public.candidates DISABLE TRIGGER candidates_touch"

echo "== scenario 8: target URL redirected with ?hostaddr="
fresh_target
scenario "hostaddr override" 2 DRILL_TARGET_URL="$TGT_URL?hostaddr=192.0.2.1"
TGT_AUTH="$(as supabase_admin "$TGT_PORT" -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'auth'")"
if [ "$TGT_AUTH" = "1" ]; then echo "  PASS  target untouched (image auth schema still present)"; else echo "  FAIL  target was modified"; FAILED=1; fi

echo "== scenario 9: target is the source cluster"
scenario "target is source" 2 DRILL_TARGET_URL="postgresql://supabase_admin:$ADMIN_PW@127.0.0.1:$SRC_PORT/postgres"
SRC_ROWS="$(as postgres "$SRC_PORT" -c "SELECT count(*) FROM public.candidates")"
if [ "$SRC_ROWS" = "250" ]; then echo "  PASS  source untouched (250 candidates)"; else echo "  FAIL  source changed: $SRC_ROWS"; FAILED=1; fi

echo "== PII and leftover checks"
if grep -rq 'synthetic.example.test\|Synthetic Person' "$OUT"; then
  echo "  FAIL  a synthetic row value appeared in drill output or the step summary"; FAILED=1
else
  echo "  PASS  no row values in any drill output or step summary"
fi
LEFT="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'backup-drill.*' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$LEFT" -eq 0 ]; then echo "  PASS  no drill work dir (dump) left behind"; else echo "  FAIL  $LEFT drill work dir(s) left behind"; FAILED=1; fi

[ "$FAILED" -eq 0 ] && echo "ALL SCENARIOS BEHAVED AS EXPECTED" || echo "SOME SCENARIOS MISBEHAVED"
exit "$FAILED"
