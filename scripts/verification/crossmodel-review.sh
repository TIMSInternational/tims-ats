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
#   export OMNIROUTE_KEY=...                 # optional (a fresh install serves without auth)
#   export OMNIROUTE_MODEL=oc/deepseek-v4-flash-free   # REQUIRED. A concrete non-Anthropic upstream:
#                                            #   no `auto/*` routers, no Anthropic families. Enforced.
#                                            #   List yours: curl -s $OMNIROUTE_URL/models | jq -r '.data[].id'
#   export OMNIROUTE_URL=...                 # optional, defaults to http://localhost:20128/v1
#
# ⚠️  OmniRoute sees the full diff. Whichever upstream you enable receives it — that is a
#     subprocessor decision for a SOC-2 scoped platform (cf. #40). Choose deliberately.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE="${1:-origin/main}"
URL="${OMNIROUTE_URL:-http://localhost:20128/v1}"
MODEL="${OMNIROUTE_MODEL:-}"   # no default on purpose — see the named-upstream guard in tier 2

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

# REQUIRE A NAMED UPSTREAM — no `auto/*` routers (#38, decided 2026-08-05).
#
# The default used to be `auto/best-coding`, which is not a model but a ROUTER: the gateway picks an
# upstream per request, so the Anthropic-family check below was validating a string that names no vendor at
# all. Probing it on 2026-08-05 returned `"model":"big-pickle"` — a codename attributable to nobody. Every
# review
# recorded as "cross-model" under that default was a DIFFERENT reviewer, but not provably a different
# VENDOR, and the gateway's list includes Anthropic models the router could legitimately have chosen.
#
# So the reviewer's identity is now a deliberate choice rather than a runtime lottery. Deliberately NO
# default: tier 2 refuses to run until someone names an upstream. That is the point — an unset variable
# must not silently buy back the guarantee this removes.
if [[ -z "${OMNIROUTE_MODEL:-}" ]]; then
  bad "OMNIROUTE_MODEL is not set — refusing to run tier 2 against an unnamed reviewer."
  warn "The old default (auto/best-coding) is a ROUTER: it resolves per-request to an unattributable"
  warn "model, so 'cross-model' could not be substantiated. Name a non-Anthropic upstream, e.g.:"
  warn "  export OMNIROUTE_MODEL=oc/deepseek-v4-flash-free   # verified working 2026-08-05"
  warn "List what your gateway serves:  curl -s $URL/models | jq -r '.data[].id'"
  exit 2
fi
if [[ "$MODEL" == auto/* ]]; then
  bad "OMNIROUTE_MODEL='$MODEL' is a ROUTER, not a model — the reviewer's vendor is undetermined."
  warn "Name a concrete upstream so the review can be attributed. See $URL/models."
  exit 2
fi

# A same-model reviewer is NOT cross-model verification. Refuse rather than quietly downgrade —
# silently weakening a control is the exact class of bug #38 was about.
#
# `fable` is in the pattern because **Fable 5 is an Anthropic model** (`claude-fable-5`) whose common
# alias contains none of the other tokens. The gateway really does serve one: `aug/fable-5` was in its
# model list on 2026-08-05 and the previous pattern accepted it as a valid cross-model reviewer.
#
# LIMIT (tier-2 finding #5, 2026-08-03): this matches the model ID string only. An OmniRoute alias that
# names none of these tokens but routes upstream to an Anthropic model would still pass. The resolved-model
# report below is the partial answer to that; the dashboard remains the authority.
# The leading `(^|[^a-z])` is a boundary, and it matters: a bare substring match means `opus` matches
# `octopus`, so an unrelated vendor's codename gets hard-failed as "Anthropic". Requiring a non-letter
# before the token fixes that while still catching every real case, because model IDs separate on `/`,
# `-`, `_` and `.`:  aug/opus4.8 ✓  tllm/CLAUDE_4_6_SONNET ✓  aug/fable-5 ✓  octopus ✗
# No trailing boundary — real IDs run the version straight on (`opus4.8`, `sonnet4.6`).
# Residual, stated rather than papered over: a token glued to a preceding letter (`myclaude`) is missed.
# Over-blocking is the safe direction here, but a guarantee that is wrong in the unsafe direction should
# be described accurately, so: this catches conventional IDs, not adversarial ones.
ANTHROPIC_RE='(^|[^a-z])(claude|anthropic|sonnet|opus|haiku|fable)'
if grep -qiE "$ANTHROPIC_RE" <<<"$MODEL"; then
  bad "OMNIROUTE_MODEL='$MODEL' is an Anthropic model — that is NOT cross-model review."
  warn "Pick a different vendor (verified working 2026-08-05: oc/deepseek-v4-flash-free,"
  warn "oc/nemotron-3-ultra-free, oc/mimo-v2.5-free)."
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

# RETRY WITH BACKOFF (#38, added 2026-08-04). A single attempt was the original behaviour and it made
# tier 2 look far less usable than it is: on 2026-08-03 it served three full review rounds, then on
# 2026-08-04 four consecutive single-shot attempts failed — twice rc=22 (HTTP >=400) and twice rc=28
# (timeout) — which is provider/gateway flakiness, not prompt size (a 28k-char retry failed identically
# to a 60k one). Without retry, a transient blip is indistinguishable from "tier 2 is unavailable" and
# silently demotes every review to the weaker same-model tier 3.
#
# Bounded deliberately: 3 attempts, 5s then 15s backoff. The point is to ride out a blip, not to hang a
# gate. Total worst case ~15min with --max-time 300 each, and every attempt is reported so a persistent
# outage is still visible rather than papered over.
#
# `-w %{http_code}` is captured so rc=22 becomes actionable: a 401/403 is a key problem, a 404 a wrong
# model or URL, a 429 quota, a 5xx the upstream. The original script reported only the curl rc, which is
# why four failures today produced no diagnosis.
# Bounded to 5 even if an operator sets OMNIROUTE_ATTEMPTS higher: the delay formula grows with the
# attempt number, so an unbounded value turns a gate into a multi-hour hang.
OMNI_ATTEMPTS="${OMNIROUTE_ATTEMPTS:-3}"
[[ "$OMNI_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || OMNI_ATTEMPTS=3
(( OMNI_ATTEMPTS > 5 )) && { warn "OMNIROUTE_ATTEMPTS=$OMNI_ATTEMPTS capped to 5."; OMNI_ATTEMPTS=5; }
CURL_RC=1
HTTP_CODE=""
for attempt in $(seq 1 "$OMNI_ATTEMPTS"); do
  HTTP_CODE="$(SYS="$SYS" DIFF="$DIFF" curl -sS --max-time 300 -w '%{http_code}' \
    "$URL/chat/completions" \
    ${AUTH_HDR[@]+"${AUTH_HDR[@]}"} -H "Content-Type: application/json" \
    --data-binary @"$REQ" -o "$RESP" 2>/dev/null)"
  CURL_RC=$?
  if [[ $CURL_RC -eq 0 && -s "$RESP" && "$HTTP_CODE" =~ ^2 ]]; then
    [[ $attempt -gt 1 ]] && warn "OmniRoute succeeded on attempt $attempt/$OMNI_ATTEMPTS."
    break
  fi
  warn "OmniRoute attempt $attempt/$OMNI_ATTEMPTS failed (curl rc=$CURL_RC, HTTP ${HTTP_CODE:-none})."
  CURL_RC=${CURL_RC:-1}
  [[ $CURL_RC -eq 0 ]] && CURL_RC=1 # a non-2xx with rc=0 is still a failure

  # Retrying a PERMANENT error just burns the backoff and delays the diagnosis. 401/403 = key problem,
  # 404 = wrong model or URL, 400/422 = malformed request. Stop immediately and say which.
  case "$HTTP_CODE" in
    400|401|403|404)
      case "$HTTP_CODE" in
        401|403) warn "HTTP $HTTP_CODE is an AUTH failure — check OMNIROUTE_KEY. Not retrying." ;;
        404)     warn "HTTP 404 — OMNIROUTE_MODEL='$MODEL' or OMNIROUTE_URL is wrong. Not retrying." ;;
        400)     warn "HTTP 400 — the gateway rejected the request body. Not retrying." ;;
      esac
      break
      ;;
  esac
  # 422 is deliberately NOT in that list: observed twice on 2026-08-04 as a TRANSIENT gateway response
  # that succeeded on the very next attempt, which is the whole reason this loop exists.

  if [[ $attempt -lt $OMNI_ATTEMPTS ]]; then
    delay=$((attempt * 10 - 5)) # 5s, 15s, 25s, 35s
    sleep "$delay"
  fi
done

if [[ $CURL_RC -ne 0 || ! -s "$RESP" ]]; then
  bad "OmniRoute request failed after $OMNI_ATTEMPTS attempt(s) (last: curl rc=$CURL_RC, HTTP ${HTTP_CODE:-none}) — tier 2 did not produce a review."
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

# WHICH MODEL ACTUALLY ANSWERED. Requesting a named upstream is not the same as being served by it — the
# gateway may alias, fall back, or substitute, and until 2026-08-05 this script never looked. It reported
# the REQUESTED string as the reviewer's identity, which is how "auto/best-coding" appeared in PR bodies
# as though it were a model. Read what came back and say so.
SERVED="$(python3 -c "
import json
try:
    print(json.load(open('$RESP')).get('model') or '')
except Exception:
    print('')
")"
# Provider-controlled string: flatten newlines/control characters and cap the length before it is
# interpolated into any log line. Local-only and low severity, but a `model` field carrying newlines or
# escape sequences could otherwise inject arbitrary text into this script's output — including something
# that reads like one of its own status lines.
SERVED="$(tr -d '\000-\037' <<<"$SERVED" | cut -c1-80)"

SERVED_SUFFIX=""
if [[ -z "$SERVED" ]]; then
  # FAIL LOUD RATHER THAN REVERT TO THE OLD BEHAVIOUR. If the response is not JSON, omits `model`, or
  # the parse throws, the previous version left SERVED empty and silently printed the REQUESTED model as
  # the reviewer's identity — exactly the misattribution this block was added to remove. Silence here
  # would make the guarantee conditional on a parse succeeding, which is not a guarantee.
  SERVED_SUFFIX=" → served-by UNREPORTED"
  warn "The gateway did not report which model served this request (no 'model' field, or unparseable)."
  warn "Attribution is therefore UNVERIFIED for this run — say so in the PR body, do not assume '$MODEL'."
elif [[ "$SERVED" != "$MODEL" ]]; then
  SERVED_SUFFIX=" → served by $SERVED"
  warn "Requested '$MODEL' but the gateway reports '$SERVED' served it."
else
  SERVED_SUFFIX=" (served by $SERVED)"
fi
# THE SERVE SIDE GETS THE SAME RULES AS THE REQUEST SIDE. Enforcing them only on the requested string is
# a guarantee the gateway can revoke: a reviewer pointed out that with `auto/*` banned at request time but
# permitted at serve time, an alias mapping oc/deepseek-v4-flash-free → auto/best-coding produced a warning
# and **exit 0** — the exact unattributable router this change exists to reject, accepted as the reviewer,
# with the run recorded CLEAN. "Choose your reviewer" is not a control if the choice is overridable.
if [[ -n "$SERVED" ]]; then
  if grep -qiE "$ANTHROPIC_RE" <<<"$SERVED"; then
    bad "The gateway served '$SERVED', an Anthropic model — this was NOT cross-model review."
    warn "Requested model was '$MODEL'. Check the provider mapping in the OmniRoute dashboard."
    exit 2
  fi
  if [[ "$SERVED" == auto/* ]]; then
    bad "The gateway served '$SERVED', a ROUTER — the reviewer's vendor is undetermined."
    warn "Requested model was '$MODEL'. An alias is remapping it to a router; fix it in the dashboard."
    exit 2
  fi
fi
# NOT failed here: an unattributable CODENAME (e.g. `big-pickle`). Rejecting those would reject most of this
# gateway's catalogue, and the decision of which upstreams are acceptable belongs to whoever sets
# OMNIROUTE_MODEL, not to this script. It is reported in every status line instead, so a PR body can be
# honest about what actually reviewed the diff. That is a deliberate limit, not an oversight.

if [[ "$(tr -d '[:space:]' <<<"$CONTENT" | wc -c)" -lt 200 ]]; then
  bad "OmniRoute returned no meaningful review — treating as NOT RUN."
  head -c 500 "$RESP" | sed 's/^/      /'
  exit 2
fi

# Anchor to the LAST non-empty line. Grepping the whole response is unsafe here: the diff under
# review contains the literal strings "VERDICT: BLOCKING"/"VERDICT: CLEAN" (this script and its docs),
# so a model quoting the diff could trip the match either way. Tier-2 finding #4, 2026-08-03.
VERDICT_LINE="$(printf '%s\n' "$CONTENT" | grep -vE '^\s*$' | tail -1)"

# Strip EMPHASIS ONLY — `**`, `__`, backticks, surrounding whitespace, one trailing period — then match
# the bare token. The LAST-LINE anchor above is preserved; only emphasis is forgiven.
#
# WHY: on 2026-08-05 a review of PR #136 returned seven substantive findings and this script exited 2
# ("Last line is not a VERDICT") because the model wrote **VERDICT: BLOCKING** in bold. A real review,
# discarded on formatting, and reported as did-not-run. Fail-closed so nothing unsafe shipped — but a
# gate that cannot recognise its own reviewer's answer wastes the review and trains its readers to treat
# exit 2 as noise. Exit 2 has to keep meaning "no reviewer ran".
#
# The rule, stated precisely, because "emphasis vs quotation" is too vague to implement against:
#   STRIPPED   — emphasis runs (`**`, `__`, `*`, backticks) ANYWHERE in the line, so both
#                `**VERDICT: CLEAN**` and `VERDICT: **CLEAN**` are accepted. Both are the model stating a
#                verdict, merely styled.
#   NOT STRIPPED — a LEADING `>` or `#`. Those are block-level markers: `> VERDICT: CLEAN` is a markdown
#                BLOCKQUOTE, i.e. a quotation of this template or of the diff, not the model asserting
#                anything. Forgiving it would turn a quote into an accepted pass.
#
# The first version of this fix stripped `>` and `#` too, and a reviewer correctly called that the very
# over-forgiveness the last-line anchor exists to prevent. A second reviewer then argued `VERDICT: **CLEAN**`
# should also be rejected as "the same class". It is not, and it is accepted on purpose: nothing about it
# marks the line as quoted, and rejecting styled-but-genuine verdicts is precisely the #136 failure this is
# repairing. Inline styling is presentation; a leading block marker is attribution.
VERDICT_BARE="$(sed -E 's/^[[:space:]]+//; s/(\*\*|__|\*|`)//g; s/[[:space:]]*\.?[[:space:]]*$//' <<<"$VERDICT_LINE")"

if ! grep -qE '^VERDICT: (BLOCKING|CLEAN)$' <<<"$VERDICT_BARE"; then
  bad "Last line is not a VERDICT — cannot confirm a real review ran."
  printf '   last line was: %s\n' "$VERDICT_LINE" >&2
  printf '   after stripping markdown: %s\n' "$VERDICT_BARE" >&2
  printf '%s\n' "$CONTENT" | tail -15 | sed 's/^/      /'
  exit 2
fi

printf '\n%s\n\n' "$CONTENT" | sed 's/^/  /'

if [[ "$VERDICT_BARE" == "VERDICT: BLOCKING" ]]; then
  bad "Tier-2 review raised BLOCKING findings ($MODEL$SERVED_SUFFIX)."
  exit 1
fi

ok "Tier-2 cross-model review CLEAN ($MODEL$SERVED_SUFFIX via OmniRoute)."
warn "Record in the PR body that tier 2 ran, not Codex."
exit 0
