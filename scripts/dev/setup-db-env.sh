#!/usr/bin/env bash
#
# setup-db-env.sh — repair packages/db/.env after a Supabase password rotation (issue #41).
#
# WHY THIS EXISTS
# ---------------
# The local Postgres credentials were broken for 4+ days because TWO things were wrong at once and
# neither source had a working pair:
#
#   packages/db/.env   stale password + legacy host `db.<ref>.supabase.co` (no longer resolves at all)
#   root .env          stale password + correct pooler host
#   Vercel production  current password + legacy host
#
# On top of that, the pooler username carries the project ref as a suffix — `postgres.<ref>`, not
# `postgres` — but Postgres still reports `user "postgres"` in the P1000 error, which made this look
# like a pure password problem for days.
#
# This script writes both URLs correctly from a single password prompt, so the next rotation is a
# 30-second job instead of a four-day investigation.
#
# WHAT IT WRITES
#   DATABASE_URL  -> transaction pooler, :6543, ?pgbouncer=true   (Prisma runtime)
#   DIRECT_URL    -> session pooler,     :5432                    (migrations, DDL, SET LOCAL ROLE)
#
# The `?pgbouncer=true` flag is required — without it Prisma's prepared statements break against
# pgbouncer. And DIRECT_URL must be session mode; the transaction pooler cannot do DDL or SET LOCAL ROLE,
# which `scripts/security/verify-rls-isolation.ts` depends on.
#
# The password is read with a hidden prompt, never echoed, never passed on a command line (which would
# expose it in `ps`), and never printed by any verification step.
#
# USAGE
#   bash scripts/dev/setup-db-env.sh
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ENV_FILE="packages/db/.env"
DEFAULT_REF="lzhfnjfsdwdywwnlqgqq"
DEFAULT_POOLER="aws-1-us-west-2.pooler.supabase.com"

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✖\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found. Run from inside the repo."

say ""
say "Supabase DB credentials → $ENV_FILE"
say "───────────────────────────────────────────────"

# ── Detect sensible defaults from whatever is already on disk ────────────────────────────────────
detected_ref="$(grep -hoE 'postgres\.[a-z0-9]{20}' "$ENV_FILE" .env 2>/dev/null | head -1 | cut -d. -f2 || true)"
[[ -z "$detected_ref" ]] && detected_ref="$(grep -hoE '[a-z0-9]{20}\.supabase\.co' "$ENV_FILE" .env 2>/dev/null | head -1 | cut -d. -f1 || true)"
[[ -z "$detected_ref" ]] && detected_ref="$DEFAULT_REF"

detected_pooler="$(grep -hoE 'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com' "$ENV_FILE" .env 2>/dev/null | head -1 || true)"
[[ -z "$detected_pooler" ]] && detected_pooler="$DEFAULT_POOLER"

# ── Input 1: project ref ─────────────────────────────────────────────────────────────────────────
printf 'Project ref [%s]: ' "$detected_ref"
read -r REF
REF="${REF:-$detected_ref}"
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || die "Project ref looks wrong: expected 20 lowercase alphanumerics, got '$REF'"

# ── Input 2: pooler host ─────────────────────────────────────────────────────────────────────────
printf 'Pooler host [%s]: ' "$detected_pooler"
read -r POOLER
POOLER="${POOLER:-$detected_pooler}"
case "$POOLER" in
  *.pooler.supabase.com) ;;
  db.*.supabase.co) die "That is the legacy direct host — it no longer resolves. Use the *.pooler.supabase.com host from Supabase Dashboard → Connect." ;;
  *) warn "Host doesn't look like a Supabase pooler; continuing anyway." ;;
esac

# ── Input 3: password (hidden, confirmed) ────────────────────────────────────────────────────────
printf 'Database password (hidden): '
read -rs PW1; printf '\n'
printf 'Confirm password:           '
read -rs PW2; printf '\n'
[[ -n "$PW1" ]]        || die "Password was empty."
[[ "$PW1" == "$PW2" ]] || die "Passwords did not match."
export SUPA_PW="$PW1"
unset PW1 PW2

# ── Back up, then rewrite ────────────────────────────────────────────────────────────────────────
BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
chmod 600 "$BACKUP"
ok "backed up → $BACKUP (contains the OLD secret; delete when satisfied)"

# Rewrite in Python so the password never appears in argv (and therefore never in `ps`).
SUPA_REF="$REF" SUPA_POOLER="$POOLER" SUPA_ENV="$ENV_FILE" python3 - <<'PY'
import os, re

ref, pooler, path, pw = os.environ['SUPA_REF'], os.environ['SUPA_POOLER'], os.environ['SUPA_ENV'], os.environ['SUPA_PW']
from urllib.parse import quote
enc = quote(pw, safe='')                       # a literal @ / : / ? in the password would corrupt the URL

urls = {
    'DATABASE_URL': f'postgresql://postgres.{ref}:{enc}@{pooler}:6543/postgres?pgbouncer=true',
    'DIRECT_URL':   f'postgresql://postgres.{ref}:{enc}@{pooler}:5432/postgres',
}

lines = open(path).read().splitlines()
seen = set()
for i, line in enumerate(lines):
    m = re.match(r'^(DATABASE_URL|DIRECT_URL)=', line)
    if m:
        key = m.group(1)
        lines[i] = f'{key}="{urls[key]}"'
        seen.add(key)
for key, val in urls.items():
    if key not in seen:
        lines.append(f'{key}="{val}"')

open(path, 'w').write('\n'.join(lines) + '\n')
print(f'  \033[32m✓\033[0m rewrote DATABASE_URL (:6543, pgbouncer) and DIRECT_URL (:5432, session)')
if enc != pw:
    print('  \033[33m!\033[0m password contained URL-special characters — percent-encoded')
PY
chmod 600 "$ENV_FILE"
unset SUPA_PW

# ── Verify ───────────────────────────────────────────────────────────────────────────────────────
say ""
say "Verifying"
say "───────────────────────────────────────────────"

if echo "SELECT 1;" | (cd packages/db && npx --yes prisma db execute --stdin --schema prisma/schema) >/dev/null 2>&1; then
  ok "prisma db execute — connected (P1000 resolved)"
else
  say ""
  die "Still cannot connect. Re-check the password in Supabase Dashboard → Connect → Session pooler.
     Restore with:  cp $BACKUP $ENV_FILE"
fi

if [[ -f scripts/security/verify-rls-isolation.ts ]]; then
  say ""
  say "RLS tenant isolation (/gate check 14)"
  say "───────────────────────────────────────────────"
  set -a; . "$ENV_FILE"; set +a
  npx --yes tsx scripts/security/verify-rls-isolation.ts || die "RLS isolation check FAILED — see issue #111"
fi

say ""
ok "Done. Local DB access restored (#41)."
say ""
say "  Next:  rm $BACKUP        # removes the old secret from disk"
say "  Note:  Vercel production's DIRECT_URL still points at the dead legacy host — fix separately."
say ""
