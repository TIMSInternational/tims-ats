#!/usr/bin/env bash
#
# codex-review.sh — adversarial cross-model verification that FAILS LOUD (issue #38).
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
# `.claude/rules/verification.md` mandates an adversarial Codex pass at every review gate. It had not
# actually run since 2026-07-22. PRs #18, #19, #22, #24, #112 and #113 all merged without it —
# including #22 and #24, which were data-exposure security fixes.
#
# The reason is not that Codex is missing. Verified 2026-08-02: `codex-cli 0.145.0` is installed,
# authenticated (chatgpt mode) and reachable. The reason is this:
#
#     $ echo "Reply OK" | codex exec --sandbox read-only -
#     ERROR: You've hit your usage limit ... try again at Aug 15th, 2026 11:44 PM.
#     $ echo $?
#     0
#
# **The CLI exits 0 when it is quota-blocked.** Any wrapper that trusts the exit code reads a refusal
# as a pass. That is the silent-pass mechanism, and it is why a mandated control evaporated for weeks
# while every gate stayed green.
#
# So this script deliberately does NOT trust the exit code. It inspects the output for refusal
# signatures and treats "the reviewer never ran" as a FAILURE, distinct from "the reviewer ran and
# found nothing".
#
# ── EXIT CODES ───────────────────────────────────────────────────────────────────────────────────
#   0  Codex ran and raised no blocking findings
#   1  Codex ran and raised blocking findings
#   2  Codex COULD NOT RUN (quota, auth, network, empty output) — verification did not happen
#
# Exit 2 must never be treated as a pass. Use the documented fallback (see --help).
#
# ── USAGE ────────────────────────────────────────────────────────────────────────────────────────
#   bash scripts/verification/codex-review.sh [BASE_REF]     # defaults to origin/main
#
set -uo pipefail

BASE="${1:-origin/main}"
cd "$(git rev-parse --show-toplevel)"

say()   { printf '%s\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()   { printf '  \033[31m✖\033[0m %s\n' "$*" >&2; }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,40p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

command -v codex >/dev/null || { bad "codex CLI not on PATH — verification cannot run."; exit 2; }

# An unresolvable BASE must NOT read as "nothing to review" -> exit 0. That is a silent pass with no
# reviewer — the exact #38 failure this script exists to prevent. Found by the tier-2 cross-model
# reviewer on 2026-08-03, as a BLOCKING finding against this very verification tooling.
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  bad "BASE ref '$BASE' does not resolve — cannot compute a diff, so NO review can run."
  warn "In CI, fetch it first:  git fetch origin main:refs/remotes/origin/main"
  exit 2
fi

DIFF="$(git diff "$BASE"...HEAD --stat)" || { bad "git diff vs '$BASE' failed — no review ran."; exit 2; }

if [[ -z "$DIFF" ]]; then
  warn "no changes vs $BASE — genuinely nothing to review."
  exit 0
fi

say ""
say "Adversarial cross-model review (Codex) vs $BASE"
say "───────────────────────────────────────────────"
say "$DIFF" | tail -20 | sed 's/^/  /'
say ""

PROMPT=$(cat <<'EOP'
You are an adversarial code reviewer. Your job is to DISAGREE, not to agree.

Review the changes on this branch against its merge base. Honesty over agreement — a review that
finds nothing is only useful if you genuinely tried to break the change.

Focus on, in order:
1. Claims in the commit messages or PR body that the diff does NOT actually support. Overstated or
   unverified claims are the highest-value finding.
2. Security: tenant isolation, data exposure (Prisma queries without explicit select), authz bypass,
   secrets, unbounded input, race conditions in multi-step DB writes.
3. What is MISSING — an untested path, an unhandled error, a doc that now contradicts the code.

Cite file:line for every finding. Do not restate what the change does; assume the reader wrote it.

End your response with exactly one line, on its own:
  VERDICT: BLOCKING   (if any finding should stop the merge)
  VERDICT: CLEAN      (if nothing should stop the merge)
EOP
)

OUT_FILE="$(mktemp)"
trap 'rm -f "$OUT_FILE"' EXIT

# NOTE: exit code is deliberately captured but NOT trusted — see the header.
printf '%s\n' "$PROMPT" | codex exec --sandbox read-only --skip-git-repo-check - \
  >"$OUT_FILE" 2>&1
CODEX_RC=$?

OUTPUT="$(cat "$OUT_FILE")"

# ── Refusal detection — the whole point of this script ───────────────────────────────────────────
# COMPLETION IS CHECKED FIRST, refusal signatures only afterwards. The signatures are grepped over
# the model's own prose, and a genuine review of a branch that so much as MENTIONS rate limiting or
# quotas quotes those words back. Proven 2026-08-31: a completed review of the notification slice
# was misclassified as quota-blocked because the reviewed diff itself contained "Codex
# quota-blocked until ~2026-09-09" (the slice doc's own check-15 row) plus a rate-limiter comment —
# and the mktemp trap deleted the only copy of the review. On any such branch the old order could
# NEVER pass. Fail-closed is intact: every path without a VERDICT still exits 2; the signatures now
# only decide the DIAGNOSIS, never override a review that demonstrably completed.
QUOTA_RE='hit your usage limit|rate limit|quota|Upgrade to Plus|try again at'
AUTH_RE='not logged in|authentication|unauthorized|401|please run .?codex login'
NET_RE='network|ECONNREFUSED|ETIMEDOUT|could not reach|dns'

# The verdict must be the LAST non-empty line, not merely present somewhere. Anchoring it anywhere in
# the output was too loose: a refusal or an aborted run that happens to echo a standalone
# `VERDICT: CLEAN` — including one quoting this repo's own docs — would satisfy it and skip every
# refusal check below. Found by the 2026-08-31 cross-model review of this very file, which is the
# second defect in it today and in the opposite direction from the first: the original was too strict
# and discarded real reviews, the fix was too lax and would have admitted fake ones. The last-line
# anchor is what `crossmodel-review.sh` already does (see its VERDICT_LINE handling), and the prompt
# above instructs the reviewer to end on exactly that line.
LAST_LINE="$(grep -vE '^\s*$' <<<"$OUTPUT" | tail -1)"
LAST_BARE="$(sed -E 's/^[[:space:]]+//; s/(\*\*|__|\*|`)//g; s/[[:space:]]*\.?[[:space:]]*$//' <<<"$LAST_LINE")"

REVIEW_COMPLETED=0
if grep -qE '^VERDICT: (BLOCKING|CLEAN)$' <<<"$LAST_BARE" \
  && [[ "$(tr -d '[:space:]' <<<"$OUTPUT" | wc -c)" -ge 200 ]]; then
  REVIEW_COMPLETED=1
fi

if [[ "$REVIEW_COMPLETED" -ne 1 ]]; then
  if grep -qiE "$QUOTA_RE" <<<"$OUTPUT"; then
    bad "Codex is QUOTA-BLOCKED — the review did not happen."
    say ""
    grep -iE "$QUOTA_RE" <<<"$OUTPUT" | head -2 | sed 's/^/      /'
    say ""
    say "  ⚠  The CLI exits 0 in this state. This is NOT a pass."
    say ""
    say "  Fallback (declared tier-2 in .claude/rules/verification.md): run a 3-lens same-model"
    say "  adversarial panel instead — security/tenant-isolation, a claim-auditor that checks every"
    say "  PR-body claim against file:line, and a coverage 'what's missing' lens. Record in the PR body"
    say "  that cross-model verification was unavailable and which fallback ran."
    exit 2
  fi

  if grep -qiE "$AUTH_RE" <<<"$OUTPUT"; then
    bad "Codex is NOT AUTHENTICATED — the review did not happen. Run: codex login"
    exit 2
  fi

  if grep -qiE "$NET_RE" <<<"$OUTPUT"; then
    bad "Codex could not reach the service — the review did not happen."
    exit 2
  fi

  # An empty or near-empty response means it produced no review, whatever the exit code said.
  if [[ "$(tr -d '[:space:]' <<<"$OUTPUT" | wc -c)" -lt 200 ]]; then
    bad "Codex returned no meaningful output (${CODEX_RC} exit) — treating as NOT RUN."
    printf '%s\n' "$OUTPUT" | head -20 | sed 's/^/      /'
    exit 2
  fi

  bad "Codex produced output but no VERDICT line — cannot confirm a real review ran."
  printf '%s\n' "$OUTPUT" | tail -25 | sed 's/^/      /'
  exit 2
fi

say ""
printf '%s\n' "$OUTPUT" | sed 's/^/  /'
say ""

# Read the SAME last line the completion check read. Scanning the whole output here would let a review
# that merely QUOTES the string "VERDICT: BLOCKING" (this file and its docs both contain it) fail a
# clean run — the mirror image of the false-positive fixed above, and just as wrong.
if [[ "$LAST_BARE" == "VERDICT: BLOCKING" ]]; then
  bad "Codex raised BLOCKING findings."
  exit 1
fi

ok "Codex review CLEAN — cross-model verification genuinely ran."
exit 0
