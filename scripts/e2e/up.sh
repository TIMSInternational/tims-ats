#!/usr/bin/env bash
# Bring up the isolated, local-only E2E stack the Playwright suite (e2e/) runs against.
# Used by BOTH CI (.github/workflows/e2e.yml) and local runs — there is no CI-only bring-up.
#
#   bash scripts/e2e/up.sh            # full bring-up (≈10–15 min cold: API image + next build)
#   E2E_SKIP_WEB_BUILD=1 bash ...     # reuse an existing apps/web/.next (local iteration only)
#   E2E_SKIP_API_BUILD=1 bash ...     # reuse an existing $E2E_API_IMAGE
#   bash scripts/e2e/down.sh          # tear down exactly what this created
#
# Prerequisites: docker, supabase CLI (2.39.x), psql, openssl, curl, node 22 + pnpm, and
# `pnpm install --frozen-lockfile` already run.
#
# What it builds, in order:
#   1. TLS: a throwaway CA + leaf cert (localhost, the Caddy container name). The C# API REFUSES
#      non-https invitation links and a non-https Supabase admin URL, so everything is served over
#      TLS even locally. Node trusts the CA via NODE_EXTRA_CA_CERTS, the API image via its trust
#      store, the browser via ignoreHTTPSErrors. Nothing ever disables certificate verification.
#   2. Supabase CLI project `tims-e2e-ci` (e2e/supabase/config.toml) with a freshly generated
#      ES256 signing key — the C# API only accepts asymmetric JWTs. No key is committed.
#   3. Schema = the committed PRODUCTION baseline (packages/db/baseline/prod-public-schema.sql),
#      munged only as far as a fresh Supabase CLI database needs (see load_schema).
#   4. Seeds: prisma/seed.ts (catalog, orgs, the platform-owner users row) and
#      prisma/seed-access.ts --apply (the 9-role permission matrix).
#   5. The local auth user for the seeded platform owner, with a random password.
#   6. Redis + LocalStack (SES, S3) containers; SES sender identities; the CV bucket.
#   7. The C# API container (prod Dockerfile + the throwaway CA in its trust store).
#   8. Caddy: TLS in front of the API and of Supabase (for the API's invitation setup), plus the
#      OIDC discovery document the API's JwtBearer handler reads.
#   9. `next build`, then scripts/e2e/web-server.mjs serves the build over TLS on the public origin
#      and proxies Supabase same-origin (its header explains both choices).
# Every URL handed to a process is asserted local first (e2e_assert_local_url).

# shellcheck source=scripts/e2e/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

e2e_require docker supabase psql openssl curl node pnpm

mkdir -p "$E2E_STATE/tls" "$E2E_STATE/logs"
chmod 700 "$E2E_STATE"

for pair in "database:$E2E_DB_URL" "supabase:$E2E_SUPABASE_URL" "supabase-direct:$E2E_SUPABASE_DIRECT_URL" \
  "app:$E2E_BASE_URL" "api:$E2E_API_URL" "localstack:$E2E_LOCALSTACK_URL"; do
  e2e_assert_local_url "${pair%%:*}" "${pair#*:}"
done

# ── 1. TLS ────────────────────────────────────────────────────────────────────────────────
make_tls() {
  local d="$E2E_STATE/tls"
  if [ -s "$d/leaf.pem" ] && [ -s "$d/ca.pem" ]; then return; fi
  e2e_log "generating throwaway TLS CA + leaf cert"
  openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj "/CN=TIMS E2E throwaway CA" \
    -keyout "$d/ca.key" -out "$d/ca.pem" >/dev/null 2>&1
  cat >"$d/leaf.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = localhost
[ext]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, DNS:$E2E_NAME-caddy, IP:127.0.0.1
EOF
  openssl req -newkey rsa:2048 -nodes -keyout "$d/leaf.key" -out "$d/leaf.csr" -config "$d/leaf.cnf" >/dev/null 2>&1
  openssl x509 -req -in "$d/leaf.csr" -CA "$d/ca.pem" -CAkey "$d/ca.key" -CAcreateserial -days 7 \
    -extfile "$d/leaf.cnf" -extensions ext -out "$d/leaf.pem" >/dev/null 2>&1
  chmod 644 "$d/leaf.key" "$d/leaf.pem" "$d/ca.pem" # read by the Caddy container user
}

# ── 2. Supabase ───────────────────────────────────────────────────────────────────────────
start_supabase() {
  if [ ! -s "$E2E_DIR/supabase/signing_keys.json" ]; then
    e2e_log "generating ES256 JWT signing key (gitignored, never committed)"
    (cd "$E2E_DIR" && supabase gen signing-key --algorithm ES256 --yes >/dev/null 2>&1) ||
      e2e_die "supabase gen signing-key failed"
    [ -s "$E2E_DIR/supabase/signing_keys.json" ] || e2e_die "signing key was not written"
    chmod 600 "$E2E_DIR/supabase/signing_keys.json"
  fi
  e2e_log "starting Supabase (project tims-e2e-ci)"
  # Only auth + REST + gateway + Postgres are needed. Storage/realtime/studio etc. are excluded to
  # keep the cold start short on a shared machine.
  supabase start --workdir "$E2E_DIR" \
    -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
    >"$E2E_STATE/logs/supabase-start.log" 2>&1 || {
    tail -40 "$E2E_STATE/logs/supabase-start.log" >&2
    e2e_die "supabase start failed"
  }
  supabase status --workdir "$E2E_DIR" -o env 2>/dev/null |
    grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|DB_URL)=' >"$E2E_STATE/supabase.env"
  chmod 600 "$E2E_STATE/supabase.env"
  # shellcheck disable=SC1091
  source "$E2E_STATE/supabase.env"
  e2e_assert_local_url "supabase status API_URL" "$API_URL"
  e2e_assert_local_url "supabase status DB_URL" "$DB_URL"
  [ -n "${ANON_KEY:-}" ] && [ -n "${SERVICE_ROLE_KEY:-}" ] || e2e_die "supabase status returned no keys"
}

# ── 3. Schema ─────────────────────────────────────────────────────────────────────────────
load_schema() {
  if [ "$(psql "$E2E_DB_URL" -tAc "select to_regclass('public.organizations') is not null")" = "t" ]; then
    e2e_log "schema already loaded — skipping"
    return
  fi
  e2e_log "loading the production schema baseline"
  # The baseline is a verbatim pg_dump. A fresh Supabase CLI database needs exactly three changes:
  #   - pg_dump 17's \restrict / \unrestrict meta-commands (nonce-normalised in the file) are
  #     psql-version specific → dropped;
  #   - `public` and `supabase_migrations` may already exist → CREATE SCHEMA IF NOT EXISTS;
  #   - prod roles the dump GRANTs to (app_tenant, ci_readonly) do not exist locally → pre-created.
  sed -E '/^\\(un)?restrict /d; s/^CREATE SCHEMA (public|supabase_migrations);/CREATE SCHEMA IF NOT EXISTS \1;/' \
    "$E2E_REPO_ROOT/packages/db/baseline/prod-public-schema.sql" >"$E2E_STATE/baseline-local.sql"
  psql "$E2E_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN CREATE ROLE app_tenant NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_readonly') THEN CREATE ROLE ci_readonly NOLOGIN; END IF;
END $$;
GRANT app_tenant TO postgres;
SQL
  psql "$E2E_DB_URL" -v ON_ERROR_STOP=1 -q -f "$E2E_STATE/baseline-local.sql" \
    >"$E2E_STATE/logs/baseline.log" 2>&1 || {
    tail -20 "$E2E_STATE/logs/baseline.log" >&2
    e2e_die "baseline load failed"
  }

  # Ownership-flipped tables (services/Tims.Platform/db/flip-ddl). The production baseline already
  # contains them, and each flip-ddl file deliberately REFUSES to run on a database that has a
  # `supabase_migrations` schema (which the baseline creates). So instead of applying them we
  # assert every table they define exists — the property the flip-ddl step exists to guarantee.
  local f tables t missing=0
  for f in "$E2E_REPO_ROOT"/services/Tims.Platform/db/flip-ddl/*.sql; do
    tables="$(sed -nE 's/^-- Tables: (.*)$/\1/p' "$f" | tr -d ' ' | tr ',' ' ')"
    [ -n "$tables" ] || e2e_die "no '-- Tables:' header in $f"
    for t in $tables; do
      if [ "$(psql "$E2E_DB_URL" -tAc "select to_regclass('public.$t') is not null")" != "t" ]; then
        e2e_log "missing flip-ddl table: $t ($f)"
        missing=1
      fi
    done
  done
  [ "$missing" = 0 ] || e2e_die "ownership-flipped tables missing after baseline load"
}

# ── 4. Seeds ──────────────────────────────────────────────────────────────────────────────
run_seeds() {
  if [ "$(psql "$E2E_DB_URL" -tAc "select count(*) from public.users where supabase_user_id = '$E2E_OWNER_SUPABASE_ID'")" = "1" ]; then
    e2e_log "seeds already applied — skipping"
    return
  fi
  e2e_log "prisma generate + seeds"
  (
    cd "$E2E_REPO_ROOT/packages/db"
    export DATABASE_URL="$E2E_DB_URL" DIRECT_URL="$E2E_DB_URL"
    pnpm exec prisma generate --schema prisma/schema >"$E2E_STATE/logs/prisma-generate.log" 2>&1
    pnpm exec tsx prisma/seed.ts >"$E2E_STATE/logs/seed.log" 2>&1
    pnpm exec tsx prisma/seed-access.ts --apply >"$E2E_STATE/logs/seed-access.log" 2>&1
  ) || {
    tail -30 "$E2E_STATE"/logs/seed*.log >&2
    e2e_die "seeding failed"
  }
}

# ── 5. Platform-owner auth user ───────────────────────────────────────────────────────────
create_owner() {
  local creds="$E2E_STATE/owner.json" password code
  if [ -s "$creds" ]; then return; fi
  password="E2e-$(openssl rand -hex 12)!9"
  code="$(curl -s -o "$E2E_STATE/logs/owner-create.json" -w '%{http_code}' \
    -X POST "$E2E_SUPABASE_DIRECT_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"$E2E_OWNER_SUPABASE_ID\",\"email\":\"$E2E_OWNER_EMAIL\",\"password\":\"$password\",\"email_confirm\":true}")"
  [ "$code" = "200" ] || [ "$code" = "201" ] || e2e_die "creating the platform-owner auth user failed (HTTP $code)"
  umask 077
  printf '{"email":"%s","password":"%s"}\n' "$E2E_OWNER_EMAIL" "$password" >"$creds"
  e2e_log "platform-owner auth user created"
}

# ── 6. Redis + LocalStack ─────────────────────────────────────────────────────────────────
start_support() {
  docker network inspect "$E2E_NETWORK" >/dev/null 2>&1 || docker network create "$E2E_NETWORK" >/dev/null
  if ! docker ps -q -f "name=^$E2E_NAME-redis$" | grep -q .; then
    docker rm -f "$E2E_NAME-redis" >/dev/null 2>&1 || true
    docker run -d --name "$E2E_NAME-redis" --network "$E2E_NETWORK" redis:7-alpine >/dev/null
  fi
  if ! docker ps -q -f "name=^$E2E_NAME-localstack$" | grep -q .; then
    docker rm -f "$E2E_NAME-localstack" >/dev/null 2>&1 || true
    # Pinned: localstack/localstack:latest now requires an auth token; 3.8 does not.
    docker run -d --name "$E2E_NAME-localstack" --network "$E2E_NETWORK" \
      -p "127.0.0.1:$E2E_LOCALSTACK_PORT:4566" -e SERVICES=ses,s3 \
      localstack/localstack:3.8 >/dev/null
  fi
  e2e_wait_http "localstack" "$E2E_LOCALSTACK_URL/_localstack/health" 180
  local addr
  for addr in noreply@tims.local noreply-e2e@example.invalid; do
    docker exec "$E2E_NAME-localstack" awslocal ses verify-email-identity --email-address "$addr" >/dev/null
  done
  docker exec "$E2E_NAME-localstack" sh -c 'awslocal s3 mb s3://tims-cv-e2e >/dev/null 2>&1 || true'
  docker exec "$E2E_NAME-localstack" awslocal s3api put-bucket-cors --bucket tims-cv-e2e \
    --cors-configuration "{\"CORSRules\":[{\"AllowedOrigins\":[\"$E2E_BASE_URL\"],\"AllowedMethods\":[\"POST\",\"PUT\",\"GET\"],\"AllowedHeaders\":[\"*\"]}]}"
}

# The web app's /api/platform relay signs every proxied request (x-tims-relay-attribution) with
# NEXTAUTH_SECRET, and the C# RelayAttributionMiddleware verifies it with Platform:ImpersonationSecret
# — so both processes get this one random value. Generated once per state dir, never printed.
relay_secret() {
  local f="$E2E_STATE/relay.secret"
  if [ ! -s "$f" ]; then
    umask 077
    openssl rand -hex 32 >"$f"
  fi
  cat "$f"
}

# ── 7. C# API ─────────────────────────────────────────────────────────────────────────────
start_api() {
  if [ "${E2E_SKIP_API_BUILD:-0}" != "1" ] || ! docker image inspect "$E2E_API_IMAGE-base" >/dev/null 2>&1; then
    e2e_log "building the C# API image (production Dockerfile)"
    docker build -f "$E2E_REPO_ROOT/services/Tims.Platform/src/Tims.Api/Dockerfile" \
      -t "$E2E_API_IMAGE-base" "$E2E_REPO_ROOT/services/Tims.Platform" >"$E2E_STATE/logs/api-build.log" 2>&1 || {
      tail -40 "$E2E_STATE/logs/api-build.log" >&2
      e2e_die "API image build failed"
    }
  fi
  # Layer the throwaway CA into the image's trust store so the API trusts Caddy's cert when it calls
  # Supabase's admin API over https (InvitationSetupOptions rejects a non-https Supabase URL).
  local ctx="$E2E_STATE/api-image"
  mkdir -p "$ctx"
  cp "$E2E_STATE/tls/ca.pem" "$ctx/e2e-ca.crt"
  cat >"$ctx/Dockerfile" <<EOF
FROM $E2E_API_IMAGE-base
USER root
COPY e2e-ca.crt /usr/local/share/ca-certificates/e2e-ca.crt
RUN update-ca-certificates >/dev/null 2>&1
USER \$APP_UID
EOF
  docker build -q -t "$E2E_API_IMAGE" "$ctx" >/dev/null

  umask 077
  # Random per bring-up; never leaves this machine / runner.
  cat >"$E2E_STATE/api.env" <<EOF
ASPNETCORE_ENVIRONMENT=Development
Platform__DatabaseConnectionString=Host=host.docker.internal;Port=$E2E_SB_DB_PORT;Database=postgres;Username=postgres;Password=postgres
Platform__SupabaseJwtIssuer=$E2E_SUPABASE_DIRECT_URL/auth/v1
Platform__SupabaseJwksMetadataAddress=http://$E2E_NAME-caddy:$E2E_OIDC_PORT/.well-known/openid-configuration
Platform__AllowedCorsOrigins=$E2E_BASE_URL
Platform__ImpersonationSecret=$(relay_secret)
Platform__RedisConnectionString=$E2E_NAME-redis:6379
Email__Enabled=true
Email__Region=us-east-1
Email__FromAddress=noreply@tims.local
AWS_ENDPOINT_URL=http://$E2E_NAME-localstack:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_REGION=us-east-1
Invitations__SetupEnabled=true
Invitations__SupabaseUrl=https://$E2E_NAME-caddy:$E2E_SB_TLS_PORT
Invitations__SupabaseServiceKey=$SERVICE_ROLE_KEY
Invitations__AppUrl=$E2E_BASE_URL
Invitations__AppOrigin=$E2E_BASE_URL
$(cat "$E2E_REPO_ROOT/scripts/e2e/api-flags.env")
EOF
  e2e_assert_env_file_local "$E2E_STATE/api.env"
  docker rm -f "$E2E_NAME-api" >/dev/null 2>&1 || true
  docker run -d --name "$E2E_NAME-api" --network "$E2E_NETWORK" \
    --add-host host.docker.internal:host-gateway \
    --env-file "$E2E_STATE/api.env" "$E2E_API_IMAGE" >/dev/null
}

# ── 8. Caddy ──────────────────────────────────────────────────────────────────────────────
start_caddy() {
  mkdir -p "$E2E_STATE/caddy"
  # GoTrue signs tokens with iss=http://127.0.0.1:<port>/auth/v1, which inside the API container
  # would resolve to the container itself. This discovery document keeps the issuer as-is but
  # points jwks_uri at an address the container can actually reach.
  cat >"$E2E_STATE/caddy/Caddyfile" <<EOF
{
  auto_https disable_redirects
  admin off
}
https://localhost:$E2E_API_TLS_PORT {
  tls /tls/leaf.pem /tls/leaf.key
  reverse_proxy $E2E_NAME-api:8080
}
https://localhost:$E2E_SB_TLS_PORT, https://$E2E_NAME-caddy:$E2E_SB_TLS_PORT {
  tls /tls/leaf.pem /tls/leaf.key
  reverse_proxy host.docker.internal:$E2E_SB_API_PORT {
    header_up Host 127.0.0.1:$E2E_SB_API_PORT
  }
}
http://:$E2E_OIDC_PORT {
  header Content-Type application/json
  respond /.well-known/openid-configuration \`{"issuer":"$E2E_SUPABASE_DIRECT_URL/auth/v1","jwks_uri":"http://host.docker.internal:$E2E_SB_API_PORT/auth/v1/.well-known/jwks.json","id_token_signing_alg_values_supported":["ES256","RS256"]}\` 200
}
EOF
  docker rm -f "$E2E_NAME-caddy" >/dev/null 2>&1 || true
  docker run -d --name "$E2E_NAME-caddy" --network "$E2E_NETWORK" \
    --add-host host.docker.internal:host-gateway \
    -p "127.0.0.1:$E2E_API_TLS_PORT:$E2E_API_TLS_PORT" \
    -p "127.0.0.1:$E2E_SB_TLS_PORT:$E2E_SB_TLS_PORT" -p "127.0.0.1:$E2E_OIDC_PORT:$E2E_OIDC_PORT" \
    -v "$E2E_STATE/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$E2E_STATE/tls:/tls:ro" \
    caddy:2 >/dev/null
  e2e_wait_http "supabase (via TLS, for the API)" "https://localhost:$E2E_SB_TLS_PORT/auth/v1/health" 60
  e2e_wait_http "oidc discovery" "http://127.0.0.1:$E2E_OIDC_PORT/.well-known/openid-configuration" 30
  e2e_wait_http "C# API" "$E2E_API_URL/health" 180
}

# ── 9. Web ────────────────────────────────────────────────────────────────────────────────
write_web_env() {
  umask 077
  cat >"$E2E_STATE/web.env" <<EOF
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_SUPABASE_URL=$E2E_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
DATABASE_URL=$E2E_DB_URL
DIRECT_URL=$E2E_DB_URL
RLS_ENFORCED=true
NEXT_PUBLIC_APP_URL=$E2E_BASE_URL
NEXT_PUBLIC_TIMS_PLATFORM_API_URL=$E2E_API_URL
NODE_EXTRA_CA_CERTS=$E2E_STATE/tls/ca.pem
MFA_ENFORCED=false
NEXTAUTH_SECRET=$(relay_secret)
PLATFORM_EMAIL_FROM=noreply-e2e@example.invalid
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_CONFIG_FILE=/dev/null
AWS_SHARED_CREDENTIALS_FILE=/dev/null
AWS_ENDPOINT_URL=$E2E_LOCALSTACK_URL
CV_UPLOADS_BUCKET=tims-cv-e2e
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
DAILY_API_URL=http://127.0.0.1:9/v1
$(cat "$E2E_REPO_ROOT/scripts/e2e/web-flags.env")
EOF
  e2e_assert_env_file_local "$E2E_STATE/web.env"
}

start_web() {
  write_web_env
  # Exported for the build (NEXT_PUBLIC_* are inlined at build time) and for the server.
  set -a
  # shellcheck disable=SC1091
  source "$E2E_STATE/web.env"
  set +a
  # No external AI/video: these must be absent so every such call fails closed locally.
  unset AWS_PROFILE BEDROCK_AWS_ACCESS_KEY_ID BEDROCK_AWS_SECRET_ACCESS_KEY DAILY_API_KEY ELEVENLABS_API_KEY || true
  if [ "${E2E_SKIP_WEB_BUILD:-0}" = "1" ] && [ -f "$E2E_REPO_ROOT/apps/web/.next/BUILD_ID" ]; then
    e2e_log "reusing existing apps/web/.next (E2E_SKIP_WEB_BUILD=1)"
  else
    e2e_log "next build (this is the slow step)"
    (cd "$E2E_REPO_ROOT/apps/web" && pnpm exec next build >"$E2E_STATE/logs/web-build.log" 2>&1) || {
      tail -40 "$E2E_STATE/logs/web-build.log" >&2
      e2e_die "next build failed"
    }
  fi
  if [ -f "$E2E_STATE/web.pid" ] && kill -0 "$(cat "$E2E_STATE/web.pid")" 2>/dev/null; then
    kill "$(cat "$E2E_STATE/web.pid")" 2>/dev/null || true
  fi
  local i=0
  while curl -sk -o /dev/null --max-time 2 "$E2E_BASE_URL/"; do
    i=$((i + 1))
    [ "$i" -ge 30 ] && e2e_die "port $E2E_WEB_TLS_PORT is still in use by another process"
    sleep 1
  done
  # scripts/e2e/web-server.mjs serves the production build over TLS on the public origin and proxies
  # Supabase same-origin (its header explains why `next start` behind a proxy does not work).
  # node directly so the recorded PID is the server itself; a plain `cmd &` (not `a && cmd &`, which
  # backgrounds a wrapper subshell) so $! is node's own PID; every stdio stream redirected so the
  # server never holds the caller's pipe open.
  (
    cd "$E2E_REPO_ROOT/apps/web"
    E2E_WEB_TLS_PORT="$E2E_WEB_TLS_PORT" E2E_TLS_CERT="$E2E_STATE/tls/leaf.pem" \
      E2E_TLS_KEY="$E2E_STATE/tls/leaf.key" E2E_SUPABASE_UPSTREAM="$E2E_SUPABASE_DIRECT_URL" \
      nohup node "$E2E_REPO_ROOT/scripts/e2e/web-server.mjs" </dev/null >"$E2E_STATE/logs/web.log" 2>&1 &
    echo $! >"$E2E_STATE/web.pid"
  )
  e2e_wait_http "web" "$E2E_BASE_URL/login" 180
  kill -0 "$(cat "$E2E_STATE/web.pid")" 2>/dev/null ||
    e2e_die "the web server exited — see $E2E_STATE/logs/web.log"
}

write_stack_state() {
  umask 077
  cat >"$E2E_STATE/stack.json" <<EOF
{
  "baseURL": "$E2E_BASE_URL",
  "apiURL": "$E2E_API_URL",
  "supabaseURL": "$E2E_SUPABASE_DIRECT_URL",
  "databaseURL": "$E2E_DB_URL",
  "localstackURL": "$E2E_LOCALSTACK_URL",
  "ownerCredsFile": "$E2E_STATE/owner.json",
  "caFile": "$E2E_STATE/tls/ca.pem"
}
EOF
}

make_tls
start_supabase
load_schema
run_seeds
create_owner
start_support
start_api
start_caddy
start_web
write_stack_state
e2e_log "stack is up: $E2E_BASE_URL  (state: $E2E_STATE)"
