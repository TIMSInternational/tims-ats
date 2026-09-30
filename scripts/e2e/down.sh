#!/usr/bin/env bash
# Tear down exactly what scripts/e2e/up.sh created: the `next start` process, the tims-e2e-ci-*
# containers + network, and the `tims-e2e-ci` Supabase CLI project (its data volume included).
# Other Supabase projects and containers on the machine are never touched.
#
#   bash scripts/e2e/down.sh               # stop everything, keep e2e/.state (logs, certs)
#   bash scripts/e2e/down.sh --purge       # also delete e2e/.state and the generated signing key

# shellcheck source=scripts/e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
set +e

if [ -f "$E2E_STATE/web.pid" ]; then
  pid="$(cat "$E2E_STATE/web.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    e2e_log "stopping next start (pid $pid)"
    kill "$pid" 2>/dev/null
    for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$E2E_STATE/web.pid"
fi

for c in api caddy localstack redis; do
  docker rm -f "$E2E_NAME-$c" >/dev/null 2>&1 && e2e_log "removed container $E2E_NAME-$c"
done
docker network rm "$E2E_NETWORK" >/dev/null 2>&1

if command -v supabase >/dev/null 2>&1; then
  e2e_log "stopping Supabase project tims-e2e-ci"
  supabase stop --workdir "$E2E_DIR" --no-backup >/dev/null 2>&1
fi

if [ "${1:-}" = "--purge" ]; then
  rm -rf "$E2E_STATE" "$E2E_DIR/supabase/signing_keys.json" "$E2E_DIR/supabase/.temp" "$E2E_DIR/supabase/.branches"
  e2e_log "purged e2e/.state and the generated signing key"
fi
e2e_log "down"
