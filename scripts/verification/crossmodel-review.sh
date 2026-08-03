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
MODEL="${OMNIROUTE_MODEL:-auto/best-coding}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✖\033[0m %s\n' "$*" >&2; }

# ── Tier 1: Codex ────────────────────────────────────────────────────────────────────────────────
printf '\nTier 1 — Codex CLI\n───────────────────────────────────────────────\n'
if [[ -x scripts/verification/codex-review.sh ]]; then
  bash scripts/verification/codex-review.sh "$BASE"
  T1=$?
  # Only 0/1 mean a review actually happened. 2 = tier 1 unavailable; anything else (127 missing,
  # 126 not executable, a crash) is ALSO "did not run" and must fall through, never exit as-is.
  if [[ $T1 -eq 0 || $T1 -eq 1 ]]; then
    exit $T1
  fi
  [[ $T1 -ne 2 ]] && warn "codex-review.sh exited $T1 (unexpected) — treating as NOT RUN."
else
  warn "scripts/verification/codex-review.sh missing or not executable — tier 1 skipped."
fi

# ── Tier 2: OmniRoute ────────────────────────────────────────────────────────────────────────────
printf '\nTier 2 — OmniRoute (cross-model fallback)\n───────────────────────────────────────────────\n'

# OMNIROUTE_KEY is OPTIONAL. Verified 2026-08-03 against v3.8.49: a fresh install serves 115 models
# from bundled free providers and accepts /v1/chat/completions with no Authorization header at all.
# Set it only if you've locked the gateway down in Dashboard → Endpoints.
AUTH_HDR=()
if [[ -n "${OMNIROUTE_KEY:-}" ]]; then
  AUTH_HDR=(-H "Authorization: Bearer $OMNIROUTE_KEY")
fi

# A same-model reviewer is NOT cross-model verification. Refuse rather than quietly downgrade —
# silently weakening a control is the exact class of bug #38 was about.
#
# LIMIT (tier-2 finding #5, 2026-08-03): this matches the model ID string only. An OmniRoute alias
# that names none of these tokens but routes upstream to an Anthropic model would pass. Treat this as
# a guard against the obvious mistake, not a guarantee — verify the upstream in the dashboard.
if grep -qiE 'claude|anthropic|sonnet|opus|haiku' <<<"$MODEL"; then
  bad "OMNIROUTE_MODEL='$MODEL' is an Anthropic model — that is NOT cross-model review."
  warn "Pick a different vendor's family (e.g. openai/gpt-4.1, meta/llama-4, deepseek/deepseek-chat)."
  exit 2
fi

if ! curl -fsS --max-time 8 ${AUTH_HDR[@]+"${AUTH_HDR[@]}"} "$URL/models" >/dev/null 2>&1; then
  bad "OmniRoute not reachable at $URL — tier 2 unavailable."
  warn "Is it running?  omniroute"
  exit 2
fi
ok "OmniRoute reachable at $URL (model: $MODEL)"

# A bad BASE must NEVER read as "nothing to review" -> exit 0. That would be a silent pass with no
# reviewer, which is the exact #38 failure this script exists to prevent. Caught by the tier-2 reviewer
# on 2026-08-03 as a BLOCKING finding against this very script.
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  bad "BASE ref '$BASE' does not resolve — cannot compute a diff, so NO review can run."
  warn "In CI, fetch it first:  git fetch origin main:refs/remotes/origin/main"
  exit 2
fi

# GENERATED ARTIFACTS ARE EXCLUDED FROM THE REVIEWED DIFF — and announced, never hidden.
#
# Why: `packages/db/baseline/prod-public-schema.sql` is an 8,781-line generated pg_dump. On its
# introducing PR it consumed the ENTIRE 40,000-character review budget, so the reviewer never saw the
# two new scripts or their tests, and reported them as "not in the diff" (tier-2 round 1, 2026-08-03).
# A gate that silently stops reviewing the code because a generated file grew is the #38 failure mode
# wearing a different hat.
#
# The exclusion is deliberately NARROW and SELF-DECLARING: only paths matching the list below are
# dropped, the reviewer is told exactly which files were withheld and their line counts, and the
# prompt instructs it to treat them as unreviewed. A reviewer that knows what it did not see can still
# say so; one that silently ran out of budget cannot. Never add a path here that contains
# hand-written logic.
GENERATED_PATHSPECS=(':(exclude)packages/db/baseline/prod-public-schema.sql')

# CODE BEFORE DOCS — because the truncation has to bite SOMETHING.
#
# The budget is a hard ceiling, and a real PR can exceed it several times over (the #115 spike was
# 115,775 characters against a 40,000 budget — 65% unseen). When that happens, whatever sits at the
# end of the diff is not reviewed. Git orders by path, so `docs/` and `.claude/` came first
# alphabetically and the scripts fell off the end: tier-2 rounds 2 and 3 both reported the new
# security-relevant scripts as "may not exist", and both missed that check 14 had already gained the
# `current_org_id()` tripwire they asked for.
#
# So order deliberately: executable code first, prose last. A truncated review of the code plus a
# summary of the docs is strictly more valuable than a complete review of the docs and none of the
# code. The reviewer is still told it saw a partial diff either way.
diff_for() { git diff "$BASE"...HEAD -- "$@" "${GENERATED_PATHSPECS[@]}"; }

CODE_PATHS=(packages apps services workers scripts tests contracts '*.json' '*.ts' '*.tsx' '*.cs' '*.sh' '*.sql' '*.yml' '*.yaml')
CODE_DIFF="$(diff_for "${CODE_PATHS[@]}")" \
  || { bad "git diff vs '$BASE' failed — no review ran."; exit 2; }
# Everything the code pathspecs did not already cover — docs, markdown, rules.
PROSE_DIFF="$(git diff "$BASE"...HEAD -- . "${GENERATED_PATHSPECS[@]}" \
  "${CODE_PATHS[@]/#/:(exclude)}")" || PROSE_DIFF=""

if [[ -n "$CODE_DIFF" && -n "$PROSE_DIFF" ]]; then
  RAW_DIFF="$CODE_DIFF
$PROSE_DIFF"
else
  RAW_DIFF="${CODE_DIFF}${PROSE_DIFF}"
fi

# The full diff, to detect the "only generated files changed" case and to report what was withheld.
FULL_STAT="$(git diff "$BASE"...HEAD --stat -- packages/db/baseline/prod-public-schema.sql)"

if [[ -z "$RAW_DIFF" ]]; then
  if [[ -n "$FULL_STAT" ]]; then
    # Refuse rather than pass: a PR that changes ONLY the generated baseline is a pure schema-drift
    # change, and that is precisely what must not slip through unreviewed.
    bad "the only changes vs $BASE are generated artifacts that are excluded from review:"
    printf '%s\n' "$FULL_STAT" | sed 's/^/      /'
    warn "Nothing was cross-model reviewed. A baseline-only change means production DDL moved —"
    warn "review it by hand against docs/architecture/ddl-governance.md §7 before merging."
    exit 2
  fi
  warn "no changes vs $BASE — genuinely nothing to review."
  exit 0
fi

if [[ -n "$FULL_STAT" ]]; then
  EXCLUDED_NOTE="
[EXCLUDED FROM THIS DIFF — generated artifacts, listed so you know what you did not see. Treat them
as UNREVIEWED; do not return CLEAN on the assumption they are fine, and do not report them as
'missing from the diff' — they exist on the branch, they were withheld to preserve budget for
hand-written code:
$FULL_STAT
]"
else
  EXCLUDED_NOTE=""
fi

# Truncate on a CHARACTER boundary, not a byte one: `head -c` can split a multi-byte UTF-8 sequence
# (this repo is full of em-dashes) and then json.dump raises UnicodeEncodeError. Also tell the model
# it is seeing a partial diff, so it cannot return CLEAN about content it never saw.
# 60,000 chars (~15k tokens) rather than the original 40,000: with code ordered first, the #115 spike's
# executable portion alone was 45,217 characters, so a 40k ceiling still cut the tests off the end.
# Tunable because the tier-2 upstreams are free providers with unadvertised limits — if a larger prompt
# makes one fail, the script exits 2 (no review) which is WORSE than a partial review, so lower it:
#   REVIEW_MAX_CHARS=30000 bash scripts/verification/crossmodel-review.sh
DIFF="$(MAXC="${REVIEW_MAX_CHARS:-60000}" python3 -c "
import os,sys
s=sys.stdin.read(); n=int(os.environ['MAXC'])
sys.stdout.write(s if len(s)<=n else s[:n]+'\n\n[TRUNCATED: diff exceeds '+str(n)+' characters. You are reviewing a PARTIAL diff — say so, and do not return CLEAN on the basis of unseen content.]')
" <<<"$RAW_DIFF")$EXCLUDED_NOTE"

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

SYS="$SYS" DIFF="$DIFF" python3 - "$MODEL" "$REQ" <<'PY'
import json, os, sys
model, out = sys.argv[1], sys.argv[2]
sys_p = os.environ['SYS']; diff = os.environ['DIFF']
json.dump({"model": model, "temperature": 0, "stream": False, "messages": [
    {"role": "system", "content": sys_p},
    {"role": "user", "content": "Review this diff:\n\n```diff\n" + diff + "\n```"},
]}, open(out, "w"))
PY

SYS="$SYS" DIFF="$DIFF" curl -fsS --max-time 300 "$URL/chat/completions" \
  ${AUTH_HDR[@]+"${AUTH_HDR[@]}"} -H "Content-Type: application/json" \
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

# Anchor to the LAST non-empty line. Grepping the whole response is unsafe here: the diff under
# review contains the literal strings "VERDICT: BLOCKING"/"VERDICT: CLEAN" (this script and its docs),
# so a model quoting the diff could trip the match either way. Tier-2 finding #4, 2026-08-03.
VERDICT_LINE="$(printf '%s\n' "$CONTENT" | grep -vE '^\s*$' | tail -1)"

if ! grep -qE '^VERDICT: (BLOCKING|CLEAN)$' <<<"$VERDICT_LINE"; then
  bad "Last line is not a VERDICT — cannot confirm a real review ran."
  printf '   last line was: %s\n' "$VERDICT_LINE" >&2
  printf '%s\n' "$CONTENT" | tail -15 | sed 's/^/      /'
  exit 2
fi

printf '\n%s\n\n' "$CONTENT" | sed 's/^/  /'

if [[ "$VERDICT_LINE" == "VERDICT: BLOCKING" ]]; then
  bad "Tier-2 review raised BLOCKING findings ($MODEL)."
  exit 1
fi

ok "Tier-2 cross-model review CLEAN ($MODEL via OmniRoute)."
warn "Record in the PR body that tier 2 ran, not Codex."
exit 0
