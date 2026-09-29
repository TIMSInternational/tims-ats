#!/usr/bin/env bash
#
# apprunner-preflight.sh — the LAST check before `aws apprunner update-service`.
#
#   apprunner-preflight.sh <service-arn> <expected-running-image> [--deploy]
#
# Run immediately before update-service by both deploy-platform-api.yml and
# rollback-platform-api.yml. Exit 0 = safe to update; exit 1 = refuse (reason printed as ::error::).
#
# Always (optimistic concurrency):
#   - the service must be RUNNING;
#   - the LIVE image must still be <expected-running-image>, the image the caller read when it
#     decided what to do. Deploy and rollback use separate concurrency groups (a rollback must never be
#     replaced by a queued deploy), so either may have changed the service since the caller looked.
#
# With --deploy (roll-forward only):
#   - refuse when $AUTODEPLOY_PAUSED is "true" (repo variable PLATFORM_API_AUTODEPLOY_PAUSED, which
#     the rollback runbook sets BEFORE rolling back and the rollback workflow requires);
#   - refuse when any rollback-platform-api.yml run is queued / waiting / pending / requested /
#     in progress. Needs GH_TOKEN with actions:read. If the query fails, refuse: an unverifiable
#     "no rollback running" is not a pass.
#
set -euo pipefail

ARN="${1:-}"
EXPECT="${2:-}"
MODE="${3:-}"
REGION="${AWS_REGION:-us-west-2}"

refuse() {
  echo "::error::preflight: $*"
  exit 1
}

[[ -n "$ARN" && -n "$EXPECT" ]] || refuse "usage: apprunner-preflight.sh <service-arn> <expected-image> [--deploy]"
[[ -z "$MODE" || "$MODE" == "--deploy" ]] || refuse "unknown mode '$MODE'"

if [[ "$MODE" == "--deploy" ]]; then
  [[ "${AUTODEPLOY_PAUSED:-}" != "true" ]] \
    || refuse "deploys are PAUSED (PLATFORM_API_AUTODEPLOY_PAUSED=true) — a rollback is in effect."
  [[ -n "${GITHUB_REPOSITORY:-}" ]] || refuse "GITHUB_REPOSITORY is not set; cannot check for a rollback run."
  for status in queued waiting pending requested in_progress; do
    N="$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/rollback-platform-api.yml/runs?status=$status&per_page=1" \
          --jq '.total_count')" || refuse "cannot query rollback runs (status=$status); refusing to deploy blind."
    [[ "$N" =~ ^[0-9]+$ ]] || refuse "unexpected rollback run count '$N' (status=$status)."
    [[ "$N" -eq 0 ]] || refuse "a rollback run is $status — refusing to deploy over it."
  done
fi

LIVE="$(aws apprunner describe-service --region "$REGION" --service-arn "$ARN" \
         --query 'Service.[Status,SourceConfiguration.ImageRepository.ImageIdentifier]' --output text)" \
  || refuse "cannot describe the service."
read -r STATUS IMAGE <<<"$LIVE"

[[ "$STATUS" == "RUNNING" ]] || refuse "service is $STATUS, not RUNNING."
[[ "$IMAGE" == "$EXPECT" ]] \
  || refuse "live image changed since it was read: expected $EXPECT, found $IMAGE. Another deploy or rollback ran; refusing."

echo "preflight ok: $STATUS $IMAGE"
