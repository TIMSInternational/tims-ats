#!/bin/bash
# Interactively prompts for the 2 Supabase secrets scripts/parity/.env needs
# (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) and writes them into that
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
  if [ -z "$value" ]; then
    echo "ERROR: empty value for $key — aborting without writing anything." >&2
    exit 1
  fi
  # Drop any existing line for this key (so re-running this script is safe/idempotent),
  # then append the new one. Uses a temp file + mv, never prints $value.
  grep -v "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp" 2>/dev/null || true
  mv "${ENV_FILE}.tmp" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}

echo "⚠️  If these keys were EVER pasted into a chat, ticket, or anywhere else non-private,"
echo "   rotate them in the Supabase dashboard FIRST (Project Settings -> API -> reset JWT secret)"
echo "   and enter the NEW values below, not the old ones."
echo ""

echo -n "Paste the anon key (input hidden), then press Enter: "
read -rs ANON_KEY
echo ""

echo -n "Paste the service_role key (input hidden), then press Enter: "
read -rs SERVICE_ROLE_KEY
echo ""

set_env_var "SUPABASE_ANON_KEY" "$ANON_KEY"
set_env_var "SUPABASE_SERVICE_ROLE_KEY" "$SERVICE_ROLE_KEY"

unset ANON_KEY SERVICE_ROLE_KEY

echo ""
echo "Done. $ENV_FILE updated — values were never echoed, logged, or printed."
echo "Next: bash scripts/deploy/cutover.sh team-intel --verify-only"
