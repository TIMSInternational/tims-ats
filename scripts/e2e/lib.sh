# shellcheck shell=bash
# shellcheck disable=SC2034  # sourced: the variables are consumed by up.sh / down.sh
# Shared configuration for the Playwright E2E stack (scripts/e2e/up.sh, down.sh, run.sh).
#
# Everything here is LOCAL-ONLY. The stack is a throwaway Supabase CLI project + the C# API
# container + LocalStack (SES/S3) + Redis + `next start`, all on this machine. Nothing in it
# may ever point at production or at the live Supabase project — `e2e_assert_local_url`
# is the control for that and every URL the stack hands to a process goes through it.
#
# Ports are fixed (the Supabase CLI reads its ports from the committed e2e/supabase/config.toml)
# and deliberately distinct from both the Supabase CLI defaults (543xx) and the long-lived
# manual E2E stack (643xx), so this can run next to either without clobbering it.

set -euo pipefail

E2E_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="$E2E_REPO_ROOT/e2e"
E2E_STATE="$E2E_DIR/.state"

# Container / network names. One prefix so down.sh can remove exactly what up.sh created.
E2E_NAME="tims-e2e-ci"
E2E_NETWORK="$E2E_NAME-net"
E2E_API_IMAGE="${E2E_API_IMAGE:-tims-api:e2e-ci}"

# Supabase CLI project (must match e2e/supabase/config.toml).
E2E_SB_API_PORT=55321
E2E_SB_DB_PORT=55322

# Host-side ports.
E2E_WEB_TLS_PORT=3543  # https://localhost:3543 — the app (scripts/e2e/web-server.mjs), as the browser sees it
E2E_API_TLS_PORT=7543  # https://localhost:7543 — the C# API as the browser/Next see it
E2E_SB_TLS_PORT=55443  # https://localhost:55443 — Supabase over TLS (C# invitation setup requires https)
E2E_OIDC_PORT=55390    # http — OIDC discovery document for the C# JwtBearer handler
E2E_LOCALSTACK_PORT=4577

E2E_BASE_URL="https://localhost:$E2E_WEB_TLS_PORT"
E2E_API_URL="https://localhost:$E2E_API_TLS_PORT"
# Browser + Next reach Supabase SAME-ORIGIN through web-server.mjs (its header explains why);
# the C# API reaches it through Caddy at https://$E2E_NAME-caddy:$E2E_SB_TLS_PORT.
E2E_SUPABASE_URL="$E2E_BASE_URL"
E2E_SUPABASE_DIRECT_URL="http://127.0.0.1:$E2E_SB_API_PORT"
E2E_DB_URL="postgresql://postgres:postgres@127.0.0.1:$E2E_SB_DB_PORT/postgres"
E2E_LOCALSTACK_URL="http://127.0.0.1:$E2E_LOCALSTACK_PORT"

# Seeded platform owner (packages/db/prisma/seed.ts creates the users row with this Supabase id;
# up.sh creates the matching LOCAL auth user with a random password).
E2E_OWNER_SUPABASE_ID="cd10598f-e1ee-4a1c-9b64-541d7a4a2488"
E2E_OWNER_EMAIL="federico@nexadev.ai"

e2e_log() { printf '\033[1;34m[e2e]\033[0m %s\n' "$*" >&2; }
e2e_die() { printf '\033[1;31m[e2e] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }

# Fail closed unless the URL's host is loopback or the Docker host alias. An unparseable URL is
# refused, never assumed safe. This is what keeps the suite from ever touching prod/live Supabase.
e2e_assert_local_url() {
  local label="$1" url="$2" host
  host="$(printf '%s' "$url" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#^[^@/]*@##; s#[/?].*$##; s#:[0-9]+$##')"
  case "$host" in
    localhost | 127.0.0.1 | host.docker.internal | "$E2E_NAME"-*) return 0 ;;
    *) e2e_die "$label is not local (host '$host'). The E2E stack refuses to touch any non-local service." ;;
  esac
}

# Every http(s)/postgres URL in a generated env file must be local — the second net under
# e2e_assert_local_url, covering values that were composed rather than passed through it.
e2e_assert_env_file_local() {
  local file="$1" url
  while IFS= read -r url; do
    e2e_assert_local_url "$(basename "$file") value" "$url"
  done < <(grep -oE '(https?|postgres(ql)?)://[^ ;"]+' "$file" | sort -u)
}

e2e_require() {
  local bin
  for bin in "$@"; do
    command -v "$bin" >/dev/null 2>&1 || e2e_die "required tool not found: $bin"
  done
}

# Wait until `curl -fsk URL` succeeds, or die after N seconds.
e2e_wait_http() {
  local label="$1" url="$2" timeout="${3:-120}" i=0
  until curl -fsk -o /dev/null --max-time 5 "$url"; do
    i=$((i + 2))
    [ "$i" -ge "$timeout" ] && e2e_die "$label did not become ready at $url within ${timeout}s"
    sleep 2
  done
  e2e_log "$label ready ($url)"
}
