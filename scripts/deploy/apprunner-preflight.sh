#!/usr/bin/env bash
#
# apprunner-preflight.sh — the LAST check before `aws apprunner update-service`.
#
#   apprunner-preflight.sh <service-arn> <expected-running-image> [--deploy]
#
# Run immediately before update-service by both deploy-platform-api.yml and
# rollback-platform-api.yml. Exit 0 = safe to update; exit 1 = refuse (reason printed as ::error::);
# exit 3 (--deploy only) = SKIP: production already runs this commit or a newer one, so there is
# nothing to do and the caller treats it as a successful no-op.
#
# The two workflows' mutating jobs share the concurrency group `platform-api-mutation`, so a pipeline
# deploy and a rollback never run update-service at the same time. This script covers what the lock
# cannot: the state that changed while a job was WAITING for it, and out-of-band changes (console/CLI),
# which no lock serializes. App Runner's UpdateService has no expected-image precondition, so for those
# this check narrows the window but cannot close it.
#
# Always:
#   - the service must be RUNNING;
#   - the LIVE image must still be <expected-running-image> (the image the caller read when it
#     decided). Rollback mode is strict. --deploy relaxes this ONLY for forward progress by another
#     pipeline deploy (see below).
#
# With --deploy (roll-forward only; needs GH_TOKEN with actions:read, GITHUB_REPOSITORY,
# GITHUB_RUN_ID, and TARGET_SHA = the 40-char commit being deployed, in a checkout with full history):
#   - refuse when $AUTODEPLOY_PAUSED is "true" (a snapshot of PLATFORM_API_AUTODEPLOY_PAUSED, which
#     the rollback runbook sets BEFORE rolling back and the rollback workflow requires);
#   - refuse when any rollback-platform-api.yml run ON MAIN is queued / waiting / pending / requested /
#     in progress (a rollback dispatched from another branch is refused by that workflow before it
#     holds AWS credentials, so it must not block deploys);
#   - refuse when ANY rollback run on main — whatever its status, including completed or cancelled —
#     was created at or after THIS deploy run was created. That rollback was requested after this deploy
#     started, so this deploy is stale by definition: it may have decided before the pause, or the
#     rollback may already have finished (or been cancelled) while this job waited for the lock;
#   - if the live image changed since `decide` read it, resolve its tag to a commit: the same commit or
#     a descendant of TARGET_SHA -> exit 3 (skip); a strict ancestor -> proceed (another pipeline deploy
#     moved production forward while this one waited; rollbacks are excluded by the checks above);
#     anything else (unresolvable, diverged) -> refuse. That refusal is NOT a policy against replacing
#     a diverged image — `decide` overwrites one BY DESIGN. It exists because this run was approved
#     against a DIFFERENT live state than the one it now finds, so it stands down and the next run
#     re-decides against what is live. A FORCED manual deploy ($FORCE_OLDER=true,
#     approved by `decide` against the image it read) refuses on ANY change instead: the operator
#     forced a regression over a specific image, not over whatever is live now.
#   Every GitHub query that fails or returns something unexpected is a refusal: an unverifiable
#   "no rollback" is not a pass.
#
set -euo pipefail

ARN="${1:-}"
EXPECT="${2:-}"
MODE="${3:-}"
REGION="${AWS_REGION:-us-west-2}"
ROLLBACK_RUNS="repos/${GITHUB_REPOSITORY:-}/actions/workflows/rollback-platform-api.yml/runs"

refuse() {
  echo "::error::preflight: $*"
  exit 1
}

count_rollbacks() { # count_rollbacks <query-string> <description> — sets N (no subshell, so refuse exits)
  N="$(gh api "$ROLLBACK_RUNS?branch=main&$1&per_page=1" --jq '.total_count')" \
    || refuse "cannot query rollback runs ($2); refusing to deploy blind."
  [[ "$N" =~ ^[0-9]+$ ]] || refuse "unexpected rollback run count '$N' ($2)."
}

[[ -n "$ARN" && -n "$EXPECT" ]] || refuse "usage: apprunner-preflight.sh <service-arn> <expected-image> [--deploy]"
[[ -z "$MODE" || "$MODE" == "--deploy" ]] || refuse "unknown mode '$MODE'"

if [[ "$MODE" == "--deploy" ]]; then
  [[ "${AUTODEPLOY_PAUSED:-}" != "true" ]] \
    || refuse "deploys are PAUSED (PLATFORM_API_AUTODEPLOY_PAUSED=true) — a rollback is in effect."
  [[ -n "${GITHUB_REPOSITORY:-}" ]] || refuse "GITHUB_REPOSITORY is not set; cannot check for a rollback run."
  [[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || refuse "GITHUB_RUN_ID is not set; cannot date this deploy."
  [[ "${TARGET_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || refuse "TARGET_SHA must be the 40-char commit being deployed."

  for status in queued waiting pending requested in_progress; do
    count_rollbacks "status=$status" "status=$status"
    [[ "$N" -eq 0 ]] || refuse "a rollback run is $status — refusing to deploy over it."
  done

  CREATED="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --jq '.created_at')" \
    || refuse "cannot read this deploy run's creation time; refusing to deploy blind."
  [[ "$CREATED" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || refuse "unexpected creation time '$CREATED' for this deploy run."
  count_rollbacks "created=%3E%3D$CREATED" "created>=$CREATED"
  [[ "$N" -eq 0 ]] || refuse "a rollback was requested at or after this deploy started ($CREATED)." \
    "This deploy stands down. If that rollback run shows as cancelled, re-dispatch it."
fi

LIVE="$(aws apprunner describe-service --region "$REGION" --service-arn "$ARN" \
         --query 'Service.[Status,SourceConfiguration.ImageRepository.ImageIdentifier]' --output text)" \
  || refuse "cannot describe the service."
read -r STATUS IMAGE <<<"$LIVE"

[[ "$STATUS" == "RUNNING" ]] || refuse "service is $STATUS, not RUNNING."

if [[ "$IMAGE" == "$EXPECT" ]]; then
  echo "preflight ok: $STATUS $IMAGE"
  exit 0
fi

CHANGED="live image changed since it was read: expected $EXPECT, found $IMAGE"
[[ "$MODE" == "--deploy" ]] || refuse "$CHANGED. Another deploy or rollback ran; refusing."
[[ "${FORCE_OLDER:-}" != "true" ]] \
  || refuse "$CHANGED, and this is a force_older deploy approved against the old image. Re-dispatch to re-decide."

LIVE_TAG="${IMAGE##*:}"
LIVE_SHA=""
if [[ "$LIVE_TAG" =~ ^[0-9a-f]{7,40}$ ]]; then
  LIVE_SHA="$(git rev-parse --verify --quiet "${LIVE_TAG}^{commit}" || true)"
fi
[[ -n "$LIVE_SHA" ]] || refuse "$CHANGED, and tag '$LIVE_TAG' does not resolve to a commit; refusing."

if git merge-base --is-ancestor "$TARGET_SHA" "$LIVE_SHA"; then
  echo "preflight skip: production already runs $LIVE_TAG, which is $TARGET_SHA or newer."
  exit 3
fi
git merge-base --is-ancestor "$LIVE_SHA" "$TARGET_SHA" \
  || refuse "$CHANGED, and $LIVE_TAG is neither an ancestor nor a descendant of $TARGET_SHA." \
    "This deploy was decided against a different live image, so it stands down; re-dispatch (or let the" \
    "next merge) re-decide — a diverged image is then replaced by main, by design."
echo "preflight ok: production moved forward to $LIVE_TAG (an ancestor of $TARGET_SHA) while this deploy waited."
