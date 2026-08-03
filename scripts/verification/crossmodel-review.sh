#!/usr/bin/env bash
#
# crossmodel-review.sh — tiered adversarial cross-model review that fails loud (#38).
#
# Orchestrates the tiers so that "the reviewer never ran" can never be mistaken for "the reviewer
# found nothing" — the failure mode that let six PRs merge unreviewed between 2026-07-22 and
# 2026-08-02 while every build reported green.
#
#   Tier 1  Codex CLI                  scripts/verification/codex-review.sh
#   Tier 2  OmniRoute -> non-Anthropic local OpenAI-compatible gateway on :20128
#   (none)  otherwise -> exit 2, with the same-model 3-lens panel as the documented manual fallback
#
# Tier 2 exists because Codex is quota-blocked until 2026-08-15. It is a REAL cross-model tier — a
# different vendor's model family — which is strictly better than the same-model panel the rule
# previously fell back to, since that shares the original author's blind spots.
#
# ── EXIT CODES ───────────────────────────────────────────────────────────────────────────────────
#   0  a reviewer ran and raised no blocking findings
#   1  a reviewer ran and raised blocking findings
#   2  NO reviewer ran — verification did not happen
#
# ── OMNIROUTE SETUP ──────────────────────────────────────────────────────────────────────────────
#   npm i -g omniroute && omniroute          # serves http://localhost:20128/v1, 100% local
#   Dashboard -> Providers : add an upstream (GitHub Models recommended — GitHub is already a
#                            processor for this repo, so it adds no new subprocessor)
#   Dashboard -> Endpoints : copy the local key
#
#   export OMNIROUTE_KEY=...                 # required
#   export OMNIROUTE_MODEL=openai/gpt-4.1    # optional; MUST NOT be an Anthropic model (enforced)
#   export OMNIROUTE_URL=...                 # optional, defaults to http://localhost:20128/v1
#
# ⚠️  OmniRoute sees the full diff. Whichever upstream you enable receives it — that is a
#     subprocessor decision for a SOC-2 scoped platform (cf. #40). Choose deliberately.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE="${1:-origin/main}"
URL="${OMNIROUTE_URL:-http://localhost:20128/v1}"
MODEL="${OMNIROUTE_MODEL:-openai/gpt-4.1}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✖\033[0m %s\n' "$*" >&2; }

# ── Tier 1: Codex ────────────────────────────────────────────────────────────────────────────────
printf '\nTier 1 — Codex CLI\n───────────────────────────────────────────────\n'
bash scripts/verification/codex-review.sh "$BASE"
T1=$?
if [[ $T1 -ne 2 ]]; then
  exit $T1     # 0 or 1 — a real review happened either way
fi

# ── Tier 2: OmniRoute ────────────────────────────────────────────────────────────────────────────
printf '\nTier 2 — OmniRoute (cross-model fallback)\n───────────────────────────────────────────────\n'

if [[ -z "${OMNIROUTE_KEY:-}" ]]; then
  bad "OMNIROUTE_KEY not set — tier 2 unavailable."
  warn "Start it:  npm i -g omniroute && omniroute      (then Dashboard → Endpoints for the key)"
  exit 2
fi

# A same-model reviewer is NOT cross-model verification. Refuse rather than quietly downgrade —
# silently weakening a control is the exact class of bug #38 was about.
if grep -qiE 'claude|anthropic|sonnet|opus|haiku' <<<"$MODEL"; then
  bad "OMNIROUTE_MODEL='$MODEL' is an Anthropic model — that is NOT cross-model review."
  warn "Pick a different vendor's family (e.g. openai/gpt-4.1, meta/llama-4, deepseek/deepseek-chat)."
  exit 2
fi

if ! curl -fsS --max-time 5 "${URL%/v1}/health" >/dev/null 2>&1 \
   && ! curl -fsS --max-time 5 -H "Authorization: Bearer $OMNIROUTE_KEY" "$URL/models" >/dev/null 2>&1; then
  bad "OmniRoute not reachable at $URL — tier 2 unavailable."
  warn "Is it running?  omniroute"
  exit 2
fi
ok "OmniRoute reachable at $URL (model: $MODEL)"

DIFF="$(git diff "$BASE"...HEAD 2>/dev/null | head -c 120000)"
if [[ -z "$DIFF" ]]; then
  warn "no changes vs $BASE — nothing to review."
  exit 0
fi

REQ="$(mktemp)"; RESP="$(mktemp)"
trap 'rm -f "$REQ" "$RESP"' EXIT

SYS='You are an adversarial code reviewer. Your job is to DISAGREE, not agree. Honesty over agreement.
Priorities, in order:
1. Claims in commit messages the diff does NOT support — overstated claims are the highest-value finding.
2. Security: tenant isolation, data exposure (Prisma queries without explicit select), authz bypass,
   secrets, unbounded input, race conditions in multi-step DB writes.
3. What is MISSING — an untested path, an unhandled error, a doc now contradicting the code.
Cite file:line for every finding. Do not restate what the change does.
End with exactly one line: "VERDICT: BLOCKING" or "VERDICT: CLEAN".'

python3 - "$MODEL" "$REQ" <<'PY'
import json, os, sys
model, out = sys.argv[1], sys.argv[2]
sys_p = os.environ['SYS']; diff = os.environ['DIFF']
json.dump({"model": model, "temperature": 0, "messages": [
    {"role": "system", "content": sys_p},
    {"role": "user", "content": "Review this diff:\n\n```diff\n" + diff + "\n```"},
]}, open(out, "w"))
PY

SYS="$SYS" DIFF="$DIFF" curl -fsS --max-time 300 "$URL/chat/completions" \
  -H "Authorization: Bearer $OMNIROUTE_KEY" -H "Content-Type: application/json" \
  --data-binary @"$REQ" -o "$RESP" 2>/dev/null
CURL_RC=$?

if [[ $CURL_RC -ne 0 || ! -s "$RESP" ]]; then
  bad "OmniRoute request failed (curl rc=$CURL_RC) — tier 2 did not produce a review."
  exit 2
fi

CONTENT="$(python3 -c "
import json,sys
try:
    d=json.load(open('$RESP'))
    print(d['choices'][0]['message']['content'])
except Exception as e:
    print('')
")"

if [[ "$(tr -d '[:space:]' <<<"$CONTENT" | wc -c)" -lt 200 ]]; then
  bad "OmniRoute returned no meaningful review — treating as NOT RUN."
  head -c 500 "$RESP" | sed 's/^/      /'
  exit 2
fi

if ! grep -qE '^VERDICT: (BLOCKING|CLEAN)' <<<"$CONTENT"; then
  bad "No VERDICT line — cannot confirm a real review ran."
  printf '%s\n' "$CONTENT" | tail -20 | sed 's/^/      /'
  exit 2
fi

printf '\n%s\n\n' "$CONTENT" | sed 's/^/  /'

if grep -qE '^VERDICT: BLOCKING' <<<"$CONTENT"; then
  bad "Tier-2 review raised BLOCKING findings ($MODEL)."
  exit 1
fi

ok "Tier-2 cross-model review CLEAN ($MODEL via OmniRoute)."
warn "Record in the PR body that tier 2 ran, not Codex."
exit 0
