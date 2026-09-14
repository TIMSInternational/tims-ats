#!/usr/bin/env bash
#
# check-deploy-freshness.sh — is the C# code on `main` actually RUNNING in production?
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
# On 2026-08-31 the live App Runner service was found running image `9a8bc81`, built 2026-07-28 —
# **242 commits behind `main`, 45 of them touching `services/Tims.Platform`**. Seven completed slices
# (19–25) had never executed in production. Nothing was broken, because every one of them is dark
# behind a default-false flag, and that is exactly why nobody noticed for thirty-four days.
#
# The cost was not an outage. It was that:
#   - Three finished domains (#81, #90, #98) were simultaneously stuck at step 5 with no visible cause.
#   - The FX stale-pin incident had a recorded remedy — "run runbook A or B" — that was NOT EXECUTABLE,
#     because `FxRefreshHostedService` and `FxSeedOnce` both post-date the deployed image. The
#     instruction sat in the handover notes for two weeks describing an action nobody could take.
#
# Root cause: no workflow deploys the API (`ci.yml` and `dotnet-platform.yml` deploy nothing;
# `services/Tims.Platform/deploy/` is terraform only). Deploys are manual, so the gap opens silently.
#
# CD on merge (the agreed fix) closes the common case. This check is the backstop for the rest: CD can
# be bypassed, disabled, or fail quietly, and a control that only exists inside the thing it guards is
# not a control. Same reasoning as check 16 vs check 14 — structural and empirical are different jobs.
#
# ── EXIT CODES (the house 0/1/2 contract — see .claude/commands/gate.md checks 14–18) ─────────────
#   0  Production is running `main` (or ahead of it in a way that is not stale C#)
#   1  DRIFT — merged C# commits are not running in production
#   2  COULD NOT RUN — no AWS creds, no service, unresolvable SHA, unparseable image
#
# Exit 2 is NOT a pass. An unverifiable deployment is precisely the state that produced the incident.
#
# ── USAGE ────────────────────────────────────────────────────────────────────────────────────────
#   bash scripts/deploy/check-deploy-freshness.sh [BASE_REF]     # defaults to origin/main
#
set -uo pipefail

BASE="${1:-origin/main}"
PROFILE="${TIMS_AWS_PROFILE:-tims-ats}"
REGION="${TIMS_AWS_REGION:-us-west-2}"   # NOT us-east-1 — that account holds other NexaDev projects only
SERVICE="${TIMS_APPRUNNER_SERVICE:-tims-platform-api}"
CSHARP_PATH="services/Tims.Platform"

cd "$(git rev-parse --show-toplevel)" || { echo "not a git repo" >&2; exit 2; }

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✖\033[0m %s\n' "$*" >&2; }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,40p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

command -v aws >/dev/null || { bad "aws CLI not on PATH — deployment freshness CANNOT be verified."; exit 2; }

say ""
say "Deployment freshness — is merged C# actually running?"
say "─────────────────────────────────────────────────────"

# FETCH FIRST. Comparing against a stale local `origin/main` is the exact failure this script exists to
# catch, committed by the script itself: a clone that has not fetched since before the undeployed
# commits landed would compute "0 behind" and report the deployment fresh. Found by the 2026-08-31
# cross-model review. A staleness detector that trusts a possibly-stale ref is not a detector.
if [[ "$BASE" == origin/* ]]; then
  REMOTE="${BASE%%/*}"
  if ! git fetch --quiet "$REMOTE" 2>/dev/null; then
    bad "Could not fetch '$REMOTE' — the comparison ref may be stale, so freshness CANNOT be asserted."
    warn "This exits 2 rather than comparing against a local ref of unknown age."
    exit 2
  fi
fi

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  bad "BASE ref '$BASE' does not resolve, even after fetching."
  exit 2
fi

ARN="$(aws apprunner list-services --profile "$PROFILE" --region "$REGION" \
        --query "ServiceSummaryList[?ServiceName=='$SERVICE'].ServiceArn" --output text 2>/dev/null)"
if [[ -z "$ARN" || "$ARN" == "None" ]]; then
  bad "App Runner service '$SERVICE' not found in $REGION (profile $PROFILE)."
  warn "The service lives in us-west-2. us-east-1 holds unrelated NexaDev projects — a region"
  warn "mistake here reads as 'the service is gone', which is how this was nearly misdiagnosed."
  exit 2
fi

IMAGE="$(aws apprunner describe-service --profile "$PROFILE" --region "$REGION" --service-arn "$ARN" \
          --query 'Service.SourceConfiguration.ImageRepository.ImageIdentifier' --output text 2>/dev/null)"
STATUS="$(aws apprunner describe-service --profile "$PROFILE" --region "$REGION" --service-arn "$ARN" \
          --query 'Service.Status' --output text 2>/dev/null)"
[[ -z "$IMAGE" || "$IMAGE" == "None" ]] && { bad "Could not read the running image identifier."; exit 2; }

DEPLOYED_TAG="${IMAGE##*:}"
if [[ -z "$DEPLOYED_TAG" || "$DEPLOYED_TAG" == "$IMAGE" ]]; then
  bad "Image identifier has no :tag — cannot map the running image to a commit: $IMAGE"
  exit 2
fi

say "  service   $SERVICE ($STATUS) in $REGION"
say "  image tag $DEPLOYED_TAG"

# The tag is expected to be a commit SHA. If it does not resolve, we cannot compare — and guessing
# "probably fine" would be the silent pass this whole file exists to prevent.
if ! git rev-parse --verify --quiet "${DEPLOYED_TAG}^{commit}" >/dev/null; then
  bad "Deployed tag '$DEPLOYED_TAG' does not resolve to a commit in this clone."
  warn "Either the tag is not a SHA, or the commit is unfetched. Try: git fetch --all"
  exit 2
fi

BEHIND="$(git rev-list --count "${DEPLOYED_TAG}..${BASE}" 2>/dev/null)" || { bad "rev-list failed."; exit 2; }
CSHARP_BEHIND="$(git rev-list --count "${DEPLOYED_TAG}..${BASE}" -- "$CSHARP_PATH" 2>/dev/null)" || CSHARP_BEHIND="?"
DEPLOY_DATE="$(git show -s --format=%ci "$DEPLOYED_TAG" 2>/dev/null | cut -d' ' -f1)"

say "  built     $DEPLOY_DATE"
say "  behind    $BEHIND commits vs $BASE  ($CSHARP_BEHIND touching $CSHARP_PATH)"
say ""

if [[ "$BEHIND" == "0" ]]; then
  ok "Production is running $BASE. Nothing merged is sitting undeployed."
  exit 0
fi

if [[ "$CSHARP_BEHIND" == "0" ]]; then
  ok "Production is $BEHIND commits behind, but NONE of them touch $CSHARP_PATH."
  say "    The running image is current for the C# service. Not drift."
  exit 0
fi

bad "DRIFT — $CSHARP_BEHIND merged commits touching $CSHARP_PATH are NOT running in production."
say ""
say "  Undeployed C# commits (most recent first):"
git log --oneline "${DEPLOYED_TAG}..${BASE}" -- "$CSHARP_PATH" | head -12 | sed 's/^/      /'
[[ "$CSHARP_BEHIND" -gt 12 ]] && say "      … and $((CSHARP_BEHIND - 12)) more"
say ""
say "  This is not necessarily an outage — merged endpoints are dark behind default-false flags."
say "  It IS a blocker for: step-5 parity verification, any canary, any flag flip, and any runbook"
say "  whose code post-dates the running image. Deploy before treating those as available."
exit 1
