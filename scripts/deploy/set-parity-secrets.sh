#!/bin/bash
# Interactively prompts for the Supabase secrets scripts/parity/.env needs
# (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — required; DATABASE_URL —
# optional, only needed by surfaces whose seed step writes fixture rows via
# direct SQL, e.g. compensation/evaluation360) and writes them into that
# file directly. Input is read with terminal echo OFF (`read -rs`) so the
# value is never printed to the screen, never appears in shell history (it's
# read via `read`, not passed as a command argument), and is never logged
# anywhere — the same secret-handling discipline as apply-compliance-sql.sh's
# DIRECT_PROD_URL fix. Run this yourself, locally; never paste key values
# into a chat, ticket, or anywhere else that persists them in plaintext.
set -euo pipefail

ENV_FILE="scripts/parity/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE does not exist yet." >&2
  echo "First run: cp scripts/parity/.env.example scripts/parity/.env" >&2
  echo "and fill in SUPABASE_URL / SUPABASE_PROJECT_REF / TIMS_CSHARP_BASE / TIMS_TS_BASE." >&2
  exit 1
fi

set_env_var() {
  local key="$1" value="$2"
  # Drop any existing line for this key (so re-running this script is safe/idempotent),
  # then append the new one. Uses a temp file + mv, never prints $value.
  grep -v "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp" 2>/dev/null || true
  mv "${ENV_FILE}.tmp" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}

# Prompts (retrying on empty input) and prints the result to stdout only —
# every diagnostic message goes to stderr so it never contaminates the
# captured value when called as VAR="$(prompt_secret "label")".
prompt_secret() {
  local label="$1" value=""
  while [ -z "$value" ]; do
    printf 'Paste the %s (input hidden), then press Enter: ' "$label" >&2
    read -rs value
    echo "" >&2
    # Strip CR and leading/trailing whitespace — a stray blank line or space
    # from clipboard/terminal paste handling is a common cause of a "paste
    # succeeded but the value came back empty" failure with a plain `read -s`.
    value="$(printf '%s' "$value" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    if [ -z "$value" ]; then
      echo "  Nothing received — try again. If pasting doesn't seem to register at all," >&2
      echo "  try Cmd+V (not a terminal right-click/middle-click paste) or retype it." >&2
    else
      echo "  Received ${#value} characters." >&2
    fi
  done
  printf '%s' "$value"
}

# Same as prompt_secret but a single empty Enter press skips it (no retry loop) —
# for the optional DATABASE_URL, which most surfaces don't need at all.
prompt_secret_optional() {
  local label="$1" value=""
  printf 'Paste the %s (input hidden), or press Enter to skip: ' "$label" >&2
  read -rs value
  echo "" >&2
  value="$(printf '%s' "$value" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [ -z "$value" ]; then
    echo "  Skipped." >&2
  else
    echo "  Received ${#value} characters." >&2
  fi
  printf '%s' "$value"
}

echo "⚠️  If these keys were EVER pasted into a chat, ticket, or anywhere else non-private,"
echo "   rotate them in the Supabase dashboard FIRST (Project Settings -> API -> reset JWT secret)"
echo "   and enter the NEW values below, not the old ones."
echo ""

ANON_KEY="$(prompt_secret "anon key")"
SERVICE_ROLE_KEY="$(prompt_secret "service_role key")"

set_env_var "SUPABASE_ANON_KEY" "$ANON_KEY"
set_env_var "SUPABASE_SERVICE_ROLE_KEY" "$SERVICE_ROLE_KEY"

unset ANON_KEY SERVICE_ROLE_KEY

echo ""
echo "Optional — only needed for surfaces whose seed step writes fixture rows via direct SQL"
echo "(e.g. compensation, evaluation360). Get it from: Supabase dashboard -> Project Settings ->"
echo "Database -> Connection string -> URI (the 'postgres' role, direct connection not pooler)."
DB_URL="$(prompt_secret_optional "direct Postgres connection string (DATABASE_URL)")"
if [ -n "$DB_URL" ]; then
  set_env_var "DATABASE_URL" "$DB_URL"
fi
unset DB_URL

echo ""
echo "Done. $ENV_FILE updated — values were never echoed, logged, or printed."
echo "Next: bash scripts/deploy/cutover.sh team-intel --verify-only"
