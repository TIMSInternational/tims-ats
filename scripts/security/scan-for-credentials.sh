#!/usr/bin/env bash
#
# Refuse to publish anything that looks like a credential (#328 review, MEDIUM-1).
#
# The baseline-capture job uploads a FRESH, not-yet-reviewed production schema dump from a PUBLIC repository.
# A function body or default written out of band could carry a token, so the job runs this over everything it
# is about to upload and uploads nothing on a hit.
#
# Prints only FILE NAMES and the pattern class that matched, never the matching text.
#
# USAGE   bash scripts/security/scan-for-credentials.sh <dir-or-file>...
# EXIT    0 = clean · 1 = a credential-shaped string was found · 2 = could not run (missing/empty input)
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "⚠ usage: scan-for-credentials.sh <dir-or-file>... — exit 2, nothing scanned" >&2
  exit 2
fi
for p in "$@"; do
  if [ ! -e "$p" ]; then
    echo "⚠ CREDENTIAL SCAN DID NOT RUN — $p does not exist. Exit 2, not a pass." >&2
    exit 2
  fi
done
if [ -z "$(find "$@" -type f -print -quit)" ]; then
  echo "⚠ CREDENTIAL SCAN DID NOT RUN — no files to scan. Exit 2, not a pass." >&2
  exit 2
fi

# Case-insensitive ERE. `sk_` needs a non-identifier character before it so `risk_score` is not a hit.
PATTERNS=(
  'bearer[[:space:]]+[A-Za-z0-9._~+/-]{8,}'
  'eyJ[A-Za-z0-9_-]{8,}'
  '(^|[^A-Za-z0-9_])sk_(live|test)?_?[A-Za-z0-9]{8,}'
  'service_role'
  'password[[:space:]]*[:=]'
  'api_?key[[:space:]]*[:=]'
  'apikey'
  'postgres(ql)?://[^[:space:]/]*:[^[:space:]/@]*@'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
)

hit=0
for pat in "${PATTERNS[@]}"; do
  files="$(grep -rEil -- "$pat" "$@" 2>/dev/null)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    hit=1
    while IFS= read -r f; do
      echo "✖ credential-shaped string (pattern: $pat) in: $f" >&2
    done <<<"$files"
  elif [ "$rc" -ne 1 ]; then
    echo "⚠ CREDENTIAL SCAN DID NOT RUN — grep failed (exit $rc). Exit 2, not a pass." >&2
    exit 2
  fi
done

if [ "$hit" -eq 1 ]; then
  echo "✖ Refusing: credential-shaped content found. Nothing should be published until a human has looked." >&2
  exit 1
fi
echo "✓ no credential-shaped strings in: $*"
