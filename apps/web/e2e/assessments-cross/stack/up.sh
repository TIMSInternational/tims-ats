#!/usr/bin/env bash
# Bring up BOTH stacks for the cross-system e2e, locally and with throwaway secrets only:
#   - tims-suite (SUITE_DIR, a checkout of release/assessments-v1 or later): suite-up.ts — PostgreSQL 16 with the
#     suite schema, PostgREST, the real API (/v1 on, webhooks, cron, DRAFT consent texts allowed) and the hosted
#     player over https;
#   - this ATS: PostgreSQL (Supabase image) with the production baseline + pending Prisma migrations + the C#
#     provider/FIT manual DDL in order, GoTrue + Mailpit, the C# Platform API (container) and apps/web (next build).
# Then it provisions the ATS as a partner client with the suite's own script (ats profile, registered origin = the
# local ATS origin) and creates the webhook subscription through the suite's public API.
#
#   SUITE_DIR=/path/to/tims-suite bash apps/web/e2e/assessments-cross/stack/up.sh
#   bash apps/web/e2e/assessments-cross/stack/down.sh
#
# Needs docker, psql, openssl, curl, node 22+, pnpm, dotnet 10, and `pnpm install` done in BOTH repos. Every URL is
# loopback; no .env file is read (scripts/e2e/env-guard.mjs proves it for apps/web).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
SUITE_DIR="${SUITE_DIR:?set SUITE_DIR to a tims-suite checkout}"
P="${CROSS_PREFIX:-assessments-cross}"
STATE="${CROSS_STATE_DIR:-$HERE/../.state}"
NET="$P-net"
WEB_PORT=57543 API_TLS_PORT=57743 API_PORT=57780 DB_PORT=57522 AUTH_PROXY_PORT=57521 GOTRUE_PORT=57599 OIDC_PORT=57590 MAIL_PORT=57525
PLAYER="https://localhost:57475"

log() { printf '\033[1;34m[cross]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[cross] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }
for b in docker psql openssl curl node pnpm dotnet; do command -v "$b" >/dev/null || die "missing $b"; done
mkdir -p "$STATE/tls" "$STATE/logs"
chmod 700 "$STATE"
umask 077

# ── TLS: a throwaway CA and one leaf for localhost, 127.0.0.1 and host.docker.internal ───────────────────
if [ ! -s "$STATE/tls/leaf.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj "/CN=assessments-cross throwaway CA" \
    -keyout "$STATE/tls/ca.key" -out "$STATE/tls/ca.pem" >/dev/null 2>&1
  printf '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=localhost\n[ext]\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1\n' >"$STATE/tls/leaf.cnf"
  openssl req -newkey rsa:2048 -nodes -keyout "$STATE/tls/leaf.key" -out "$STATE/tls/leaf.csr" -config "$STATE/tls/leaf.cnf" >/dev/null 2>&1
  openssl x509 -req -in "$STATE/tls/leaf.csr" -CA "$STATE/tls/ca.pem" -CAkey "$STATE/tls/ca.key" -CAcreateserial -days 3 \
    -extfile "$STATE/tls/leaf.cnf" -extensions ext -out "$STATE/tls/leaf.pem" >/dev/null 2>&1
  chmod 644 "$STATE/tls/leaf.pem" "$STATE/tls/leaf.key" "$STATE/tls/ca.pem"
fi

# ── ATS database ──────────────────────────────────────────────────────────────────────────────────────
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
[ -s "$STATE/atsdb.pw" ] || openssl rand -hex 16 >"$STATE/atsdb.pw"
PW="$(cat "$STATE/atsdb.pw")"
DB="postgresql://postgres:$PW@127.0.0.1:$DB_PORT/postgres"
if ! docker ps -q -f "name=^$P-ats-db$" | grep -q .; then
  log "ATS database"
  docker run -d --name "$P-ats-db" --network "$NET" -e "POSTGRES_PASSWORD=$PW" -p "127.0.0.1:$DB_PORT:5432" \
    public.ecr.aws/supabase/postgres:17.4.1.074 >/dev/null
  until psql "$DB" -Atc 'select 1' >/dev/null 2>&1; do sleep 2; done
  PGPASSWORD="$PW" psql -h 127.0.0.1 -p "$DB_PORT" -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<SQL
ALTER ROLE supabase_auth_admin WITH PASSWORD '$PW';
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN CREATE ROLE app_tenant NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_readonly') THEN CREATE ROLE ci_readonly NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_rls_probe') THEN CREATE ROLE ci_rls_probe NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_drill_reader') THEN CREATE ROLE backup_drill_reader NOLOGIN; END IF;
END \$\$;
GRANT app_tenant TO postgres;
SQL
  # The production baseline (as scripts/e2e/up.sh loads it), then every Prisma migration after applied-through.txt,
  # then the C# manual DDL in the owner order (docs/architecture/csharp-migration/assessment-provider-connector.md).
  sed -E '/^\\(un)?restrict /d; s/^CREATE SCHEMA (public|supabase_migrations);/CREATE SCHEMA IF NOT EXISTS \1;/' \
    "$ROOT/packages/db/baseline/prod-public-schema.sql" >"$STATE/baseline-local.sql"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$STATE/baseline-local.sql" >"$STATE/logs/baseline.log" 2>&1 || die "baseline load failed"
  through="$(tr -d '[:space:]' <"$ROOT/packages/db/baseline/applied-through.txt")"
  for dir in "$ROOT"/packages/db/prisma/migrations/*/; do
    [[ "$(basename "$dir")" > "$through" ]] || continue
    psql "$DB" -v ON_ERROR_STOP=1 -q -f "$dir/migration.sql" >>"$STATE/logs/migrations.log" 2>&1 || die "migration $(basename "$dir") failed"
  done
  for f in 20261107232524_assessment_providers 20261108224533_assessment_provider_consent_capture \
    20261109010328_assessment_provider_attempt_poll 20261109011531_fit_v2_provider_recompute \
    20261109030506_fit_v2_provider_erasure_recompute 20261109055548_assessment_provider_queues; do
    psql "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/services/Tims.Platform/db/manual/$f.sql" >>"$STATE/logs/manual-ddl.log" 2>&1 || die "manual DDL $f failed"
  done
fi

# ── GoTrue (ES256, like production's asymmetric keys) + Mailpit (the candidate's sign-in code) ──────────────
if [ ! -s "$STATE/jwt-keys.json" ]; then
  node -e '
const c=require("crypto"),fs=require("fs"),dir=process.argv[1];
const {privateKey}=c.generateKeyPairSync("ec",{namedCurve:"P-256"});const kid=c.randomUUID();
fs.writeFileSync(dir+"/jwt-keys.json",JSON.stringify([{...privateKey.export({format:"jwk"}),kid,alg:"ES256",use:"sig",key_ops:["sign","verify"]}]));
const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const sign=(cl)=>{const h=b({alg:"ES256",typ:"JWT",kid}),p=b(cl);return h+"."+p+"."+c.sign("sha256",Buffer.from(h+"."+p),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");};
const now=Math.floor(Date.now()/1000);
fs.writeFileSync(dir+"/service.key",sign({role:"service_role",iss:"supabase",iat:now,exp:now+86400}));
fs.writeFileSync(dir+"/anon.key",sign({role:"anon",iss:"supabase",iat:now,exp:now+86400}));
fs.writeFileSync(dir+"/jwt-hs.secret",c.randomBytes(32).toString("hex"));' "$STATE"
fi
docker ps -q -f "name=^$P-ats-mail$" | grep -q . ||
  docker run -d --name "$P-ats-mail" --network "$NET" -p "127.0.0.1:$MAIL_PORT:8025" public.ecr.aws/supabase/mailpit:v1.22.3 >/dev/null
if ! docker ps -q -f "name=^$P-ats-auth$" | grep -q .; then
  cat >"$STATE/gotrue.env" <<EOF
GOTRUE_API_HOST=0.0.0.0
PORT=9999
API_EXTERNAL_URL=https://localhost:$WEB_PORT/auth/v1
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:$PW@$P-ats-db:5432/postgres
GOTRUE_SITE_URL=https://localhost:$WEB_PORT
GOTRUE_URI_ALLOW_LIST=https://localhost:$WEB_PORT/**
GOTRUE_DISABLE_SIGNUP=false
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_SECRET=$(cat "$STATE/jwt-hs.secret")
GOTRUE_JWT_KEYS=$(cat "$STATE/jwt-keys.json")
GOTRUE_JWT_ISSUER=http://127.0.0.1:$AUTH_PROXY_PORT/auth/v1
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_SMTP_HOST=$P-ats-mail
GOTRUE_SMTP_PORT=1025
GOTRUE_SMTP_ADMIN_EMAIL=noreply@assessments-cross.invalid
GOTRUE_SMTP_SENDER_NAME=TIMS ATS local e2e
GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
GOTRUE_RATE_LIMIT_OTP=1000
GOTRUE_RATE_LIMIT_VERIFY=1000
GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000
GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS=1000
GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify
GOTRUE_PASSWORD_MIN_LENGTH=12
EOF
  docker run -d --name "$P-ats-auth" --network "$NET" -p "127.0.0.1:$GOTRUE_PORT:9999" --env-file "$STATE/gotrue.env" \
    public.ecr.aws/supabase/gotrue:v2.178.0 >/dev/null
  until curl -s -o /dev/null "http://127.0.0.1:$GOTRUE_PORT/health"; do sleep 1; done
fi

start_bg() { # name pidfile log cmd...
  local name="$1" pid="$STATE/$1.pid" out="$STATE/logs/$1.log"
  shift
  if [ -f "$pid" ] && kill -0 "$(cat "$pid")" 2>/dev/null; then return; fi
  nohup "$@" </dev/null >"$out" 2>&1 &
  echo $! >"$pid"
}
X_AUTH_PROXY_PORT=$AUTH_PROXY_PORT X_GOTRUE_PORT=$GOTRUE_PORT X_OIDC_PORT=$OIDC_PORT X_API_TLS_PORT=$API_TLS_PORT \
  X_API_PORT=$API_PORT X_ISSUER="http://127.0.0.1:$AUTH_PROXY_PORT/auth/v1" X_JWKS_URI="http://$P-ats-auth:9999/.well-known/jwks.json" \
  X_TLS_CERT="$STATE/tls/leaf.pem" X_TLS_KEY="$STATE/tls/leaf.key" start_bg proxies node "$HERE/proxies.mjs"
until curl -s -o /dev/null "http://127.0.0.1:$AUTH_PROXY_PORT/auth/v1/health"; do sleep 1; done

# ── Seeds and the users this run signs in as ───────────────────────────────────────────────────────────
if [ "$(psql "$DB" -tAc "select count(*) from users where email='hr@tims.co'")" != "1" ]; then
  log "seeds"
  openssl rand -hex 12 >"$STATE/seed-user.pw"
  (
    cd "$ROOT/packages/db"
    export DATABASE_URL="$DB" DIRECT_URL="$DB"
    pnpm exec prisma generate --schema prisma/schema >"$STATE/logs/prisma-generate.log" 2>&1
    pnpm exec tsx prisma/seed.ts >"$STATE/logs/seed.log" 2>&1
    pnpm exec tsx prisma/seed-access.ts --apply >"$STATE/logs/seed-access.log" 2>&1
    NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$AUTH_PROXY_PORT" SUPABASE_SERVICE_ROLE_KEY="$(cat "$STATE/service.key")" \
      SEED_USER_PASSWORD="Pw-$(cat "$STATE/seed-user.pw")" pnpm exec tsx prisma/seed-users.ts >"$STATE/logs/seed-users.log" 2>&1
    pnpm exec tsx prisma/seed-demo.ts >"$STATE/logs/seed-demo.log" 2>&1
  ) || die "seeding failed (see $STATE/logs)"
  echo "Own-$(openssl rand -hex 12)!9" >"$STATE/owner.pw"
  K="$(cat "$STATE/service.key")"
  owner_id="$(psql "$DB" -tAc "select supabase_user_id from users where email='federico@nexadev.ai'")"
  curl -sf -o /dev/null -X POST "http://127.0.0.1:$AUTH_PROXY_PORT/auth/v1/admin/users" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"$owner_id\",\"email\":\"federico@nexadev.ai\",\"password\":\"$(cat "$STATE/owner.pw")\",\"email_confirm\":true}" ||
    die "creating the platform-owner auth user failed"
fi

# ── tims-suite ────────────────────────────────────────────────────────────────────────────────────────
if [ ! -s "$STATE/suite.json" ] || ! kill -0 "$(cat "$STATE/suite-up.pid" 2>/dev/null)" 2>/dev/null; then
  log "tims-suite (schema, API, hosted player)"
  rm -f "$STATE/suite.json"
  SUITE_DIR="$SUITE_DIR" STATE_DIR="$STATE" TLS_CERT="$STATE/tls/leaf.pem" TLS_KEY="$STATE/tls/leaf.key" CA_PEM="$STATE/tls/ca.pem" \
    PREFIX="$P-suite" SHIM="$HERE/suite-loopback-shim.cjs" start_bg suite-up "$SUITE_DIR/apps/api/node_modules/.bin/tsx" "$HERE/suite-up.ts"
  until [ -s "$STATE/suite.json" ]; do kill -0 "$(cat "$STATE/suite-up.pid")" 2>/dev/null || die "suite-up failed ($STATE/logs/suite-up.log)"; sleep 3; done
fi
start_bg v4forward node "$HERE/v4forward.mjs" 57475 57476
sj() { node -p "require('$STATE/suite.json').$1"; }

if [ ! -s "$STATE/provision.out" ]; then
  log "provisioning the ATS partner client and its webhook subscription at the suite"
  (cd "$SUITE_DIR/apps/api" && SUPABASE_URL="$(sj supabaseUrl)" SUPABASE_SERVICE_ROLE_KEY="$(sj serviceKey)" ./node_modules/.bin/tsx \
    scripts/v1-create-partner-client.ts --name "TIMS ATS (local cross e2e)" --profile ats --origins "https://localhost:$WEB_PORT" \
    --session-rate-limit 3000 >"$STATE/provision.out" 2>"$STATE/logs/provision.err") || die "provisioning failed"
  (cd "$SUITE_DIR/apps/api" && V1_CLIENT_ID="$(awk '/^client_id:/{print $2}' "$STATE/provision.out")" \
    V1_CLIENT_SECRET="$(awk '/^client_secret:/{print $2}' "$STATE/provision.out")" NODE_EXTRA_CA_CERTS="$STATE/tls/ca.pem" \
    ./node_modules/.bin/tsx scripts/v1-create-webhook-subscription.ts --api-base "$PLAYER" \
    --url "https://localhost:$API_TLS_PORT/webhooks/tims-assessments" \
    --events assignment.started,session.completed,session.voided,result.ready,assignment.expired,assignment.voided,subject.erased \
    --description "TIMS ATS local cross e2e" >"$STATE/webhook.out" 2>"$STATE/logs/webhook.err") || die "webhook subscription failed"
fi

# ── the C# Platform API (container; the throwaway CA in its trust store) ─────────────────────────────────
[ -s "$STATE/relay.secret" ] || openssl rand -hex 32 >"$STATE/relay.secret"
cat >"$STATE/api.env" <<EOF
ASPNETCORE_ENVIRONMENT=Development
ASPNETCORE_URLS=http://+:8080
Platform__DatabaseConnectionString=Host=$P-ats-db;Port=5432;Database=postgres;Username=postgres;Password=$PW
Platform__SupabaseJwtIssuer=http://127.0.0.1:$AUTH_PROXY_PORT/auth/v1
Platform__SupabaseJwksMetadataAddress=http://host.docker.internal:$OIDC_PORT/.well-known/openid-configuration
Platform__AllowedCorsOrigins=https://localhost:$WEB_PORT
Platform__ImpersonationSecret=$(cat "$STATE/relay.secret")
Email__Enabled=false
AWS_ENDPOINT_URL=http://127.0.0.1:9
AWS_ACCESS_KEY_ID=not-a-key
AWS_SECRET_ACCESS_KEY=not-a-secret
AWS_REGION=us-east-1
Platform__AssessmentProvidersEnabled=true
Platform__CandidateConsentEnabled=true
Platform__FitEngineReadEnabled=true
Platform__FitEngineWriteEnabled=true
Platform__FitEngineV2Enabled=true
AssessmentProviders__BaseUrl=https://host.docker.internal:57475/api
AssessmentProviders__TokenUrl=https://host.docker.internal:57475/api/v1/oauth/token
AssessmentProviders__ClientId=$(awk '/^client_id:/{print $2}' "$STATE/provision.out")
AssessmentProviders__ClientSecret=$(awk '/^client_secret:/{print $2}' "$STATE/provision.out")
AssessmentProviders__WebhookSigningSecret=$(awk '/^signing_secret:/{print $2}' "$STATE/webhook.out")
AssessmentProviders__PortalBaseUrl=https://localhost:$WEB_PORT
Invitations__SupabaseUrl=https://host.docker.internal:$WEB_PORT
Invitations__SupabaseServiceKey=$(cat "$STATE/service.key")
$(grep -v '^#' "$ROOT/scripts/e2e/api-flags.env" | grep -v '^$')
EOF
if [ "${CROSS_SKIP_API_BUILD:-0}" != 1 ] || [ ! -f "$STATE/api-publish/Tims.Api.dll" ]; then
  log "dotnet publish"
  (cd "$ROOT/services/Tims.Platform" && dotnet publish src/Tims.Api/Tims.Api.csproj -c Release -o "$STATE/api-publish" \
    -p:OpenApiGenerateDocumentsOnBuild=false >"$STATE/logs/api-publish.log" 2>&1) || die "dotnet publish failed"
fi
docker rm -f "$P-ats-api" >/dev/null 2>&1 || true
docker run -d --name "$P-ats-api" --network "$NET" --add-host host.docker.internal:host-gateway -p "127.0.0.1:$API_PORT:8080" \
  --env-file "$STATE/api.env" -v "$STATE/api-publish:/app:ro" -v "$STATE/tls/ca.pem:/usr/local/share/ca-certificates/cross-ca.crt:ro" \
  --entrypoint sh mcr.microsoft.com/dotnet/aspnet:10.0 -c "update-ca-certificates >/dev/null 2>&1; cd /app && exec dotnet Tims.Api.dll" >/dev/null
until curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$API_PORT/health"; do sleep 2; done

# ── apps/web: next build with the provider + FIT v2 + candidate-consent flags, served over TLS ──────────────────
cat >"$STATE/web.env" <<EOF
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_SUPABASE_URL=https://localhost:$WEB_PORT
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(cat "$STATE/anon.key")
SUPABASE_SERVICE_ROLE_KEY=$(cat "$STATE/service.key")
DATABASE_URL=$DB
DIRECT_URL=$DB
RLS_ENFORCED=true
NEXT_PUBLIC_APP_URL=https://localhost:$WEB_PORT
NEXT_PUBLIC_TIMS_PLATFORM_API_URL=https://localhost:$API_TLS_PORT
NODE_EXTRA_CA_CERTS=$STATE/tls/ca.pem
MFA_ENFORCED=false
NEXTAUTH_SECRET=$(cat "$STATE/relay.secret")
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=not-a-key
AWS_SECRET_ACCESS_KEY=not-a-secret
AWS_CONFIG_FILE=/dev/null
AWS_SHARED_CREDENTIALS_FILE=/dev/null
AWS_ENDPOINT_URL=http://127.0.0.1:9
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
DAILY_API_URL=http://127.0.0.1:9/v1
TIMS_E2E_STACK=1
NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP=true
NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP=true
NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP=true
$(grep -v '^#' "$ROOT/scripts/e2e/web-flags.env" | grep -v '^$')
BEDROCK_AWS_ACCESS_KEY_ID=
BEDROCK_AWS_SECRET_ACCESS_KEY=
DAILY_API_KEY=
ELEVENLABS_API_KEY=
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
VERCEL=
VERCEL_ENV=
VERCEL_URL=
EOF
(
  cd "$ROOT/apps/web"
  set -a
  # shellcheck disable=SC1091
  . "$STATE/web.env"
  set +a
  unset AWS_PROFILE || true
  node "$ROOT/scripts/e2e/env-guard.mjs" || die "web env is not isolated / not local"
  if [ "${CROSS_SKIP_WEB_BUILD:-0}" != 1 ] || [ ! -f .next/BUILD_ID ]; then
    log "next build"
    pnpm exec next build >"$STATE/logs/web-build.log" 2>&1 || die "next build failed"
  fi
  [ -f "$STATE/web.pid" ] && kill "$(cat "$STATE/web.pid")" 2>/dev/null || true
  E2E_WEB_TLS_PORT=$WEB_PORT E2E_TLS_CERT="$STATE/tls/leaf.pem" E2E_TLS_KEY="$STATE/tls/leaf.key" \
    E2E_SUPABASE_UPSTREAM="http://127.0.0.1:$AUTH_PROXY_PORT" nohup node "$ROOT/scripts/e2e/web-server.mjs" </dev/null >"$STATE/logs/web.log" 2>&1 &
  echo $! >"$STATE/web.pid"
)
until curl -s -o /dev/null --max-time 3 --cacert "$STATE/tls/ca.pem" "https://localhost:$WEB_PORT/login"; do sleep 2; done

node -e '
const fs=require("fs"),s=process.argv[1],r=(f)=>fs.readFileSync(s+"/"+f,"utf8").trim(),suite=JSON.parse(r("suite.json"));
fs.writeFileSync(s+"/cross.json",JSON.stringify({
  baseURL:"https://localhost:'$WEB_PORT'", apiURL:"https://localhost:'$API_TLS_PORT'", authURL:"http://127.0.0.1:'$AUTH_PROXY_PORT'/auth/v1",
  anonKey:r("anon.key"), caFile:s+"/tls/ca.pem", atsDatabaseUrl:"'$DB'", mailpitURL:"http://127.0.0.1:'$MAIL_PORT'",
  owner:{email:"federico@nexadev.ai",password:r("owner.pw")}, staffPassword:"Pw-"+r("seed-user.pw"), orgSlug:"tims-international",
  suite:{dbContainer:suite.dbContainer,apiUrl:suite.apiUrl,playerOrigin:suite.playerOrigin,cronSecret:suite.cronSecret}},null,2),{mode:0o600});' "$STATE"
log "both stacks are up. Run the spec with ASSESSMENTS_CROSS_STATE=$STATE/cross.json (README.md)"
