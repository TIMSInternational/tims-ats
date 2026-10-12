#!/usr/bin/env bash
# Verify that the workers service actually settled on the task definition the deploy registered.
# Run by deploy-platform-workers.yml right after `aws ecs wait services-stable`, and polls past it (see below).
# Tested by tests/governance/workers-deploy-facts.test.ts (with a fake `aws` on PATH).
#
# WHY: the service runs with deploymentCircuitBreaker={enable=true,rollback=true}. When the new task
# never becomes healthy the breaker rolls back, the service settles again on the OLD revision (one
# deployment, runningCount == desiredCount), and `services-stable` returns 0. Without this check the job
# went green and printed "Workers rolled to <tag>" for a deploy that never happened.
#
# `services-stable` waits for the deployment count and runningCount, NOT for the deployment's
# rolloutState: ECS flips that to COMPLETED a little after the service looks stable. So one snapshot
# taken right after the waiter can see IN_PROGRESS for a perfectly healthy deploy. This script POLLS.
#
# Each poll of describe-services is classified:
#   PASS  (exit 0)  services[0].taskDefinition == NEW_TD, exactly one deployment, it is PRIMARY with
#                   taskDefinition == NEW_TD and rolloutState == COMPLETED, and runningCount == desiredCount.
#   WAIT            the PRIMARY deployment is NEW_TD and rolloutState is IN_PROGRESS, or it is COMPLETED but
#                   not settled yet (an old deployment still draining, or running < desired).
#   FAIL  (exit 1)  rolloutState FAILED (rolloutStateReason is printed); the service or its PRIMARY deployment
#                   is not NEW_TD (a circuit-breaker rollback); no PRIMARY deployment; any other rolloutState;
#                   a failed or unparseable describe-services. A failing call is never read as "still waiting".
# WAIT repeats every VERIFY_ROLL_INTERVAL_SECONDS until VERIFY_ROLL_TIMEOUT_SECONDS have passed, and then
# FAILS LOUD with the last observation. The bound keeps the job inside its timeout-minutes.
#
# Usage: workers-verify-roll.sh <new task definition ARN>
# Inputs (environment): AWS_REGION, ECS_CLUSTER, ECS_SERVICE;
#   optional VERIFY_ROLL_TIMEOUT_SECONDS (default 900), VERIFY_ROLL_INTERVAL_SECONDS (default 15).
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}" "${ECS_CLUSTER:?ECS_CLUSTER is required}" "${ECS_SERVICE:?ECS_SERVICE is required}"

die() { echo "::error::workers-verify-roll: $*" >&2; exit 1; }

NEW_TD="${1:-}"
[[ "$NEW_TD" =~ ^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task-definition/[A-Za-z0-9_-]+:[0-9]+$ ]] \
  || die "not a task definition ARN: '$NEW_TD'"

TIMEOUT="${VERIFY_ROLL_TIMEOUT_SECONDS:-900}"
INTERVAL="${VERIFY_ROLL_INTERVAL_SECONDS:-15}"
[[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || die "VERIFY_ROLL_TIMEOUT_SECONDS must be a positive integer, got '$TIMEOUT'"
[[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]] || die "VERIFY_ROLL_INTERVAL_SECONDS must be a positive integer, got '$INTERVAL'"

# One describe-services call, reduced to a summary with a verdict: PASS, WAIT or FAIL.
poll() {
  local out
  out="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
           --services "$ECS_SERVICE" --output json)" \
    || die "cannot read the service after the roll; the deploy is NOT verified."
  jq -ec --arg td "$NEW_TD" '
    .services[0] as $s
    | ($s.deployments // []) as $d
    | ([$d[] | select(.status == "PRIMARY")] | first) as $p
    | ($p.rolloutState // null) as $rs
    | {
        serviceTd: $s.taskDefinition,
        deployments: ($d | length),
        primaryTd: ($p.taskDefinition // null),
        rolloutState: $rs,
        rolloutReason: ($p.rolloutStateReason // null),
        running: $s.runningCount,
        desired: $s.desiredCount
      }
    | .verdict = (
        if .serviceTd != $td or .primaryTd != $td then "FAIL"
        elif $rs == "COMPLETED" and .deployments == 1 and .running == .desired then "PASS"
        elif $rs == "COMPLETED" or $rs == "IN_PROGRESS" then "WAIT"
        else "FAIL" end)' <<<"$out" 2>/dev/null \
    || die "describe-services returned no service or unparseable output; the deploy is NOT verified."
}

START=$SECONDS
while :; do
  SUMMARY="$(poll)"
  case "$(jq -r '.verdict' <<<"$SUMMARY")" in
    PASS)
      echo "verified: service runs $NEW_TD, rollout COMPLETED"
      exit 0 ;;
    WAIT) ;;
    *)
      if [ "$(jq -r '.rolloutState' <<<"$SUMMARY")" = "FAILED" ]; then
        die "the rollout of $NEW_TD FAILED: $(jq -r '.rolloutReason // "no rolloutStateReason given"' <<<"$SUMMARY"). Observed: $SUMMARY"
      fi
      die "the service did NOT settle on $NEW_TD (a circuit-breaker rollback leaves it on the previous revision). Observed: $SUMMARY" ;;
  esac
  if (( SECONDS - START + INTERVAL > TIMEOUT )); then
    die "timed out after ${TIMEOUT}s waiting for the rollout of $NEW_TD to COMPLETE; the deploy is NOT verified. Last observed: $SUMMARY"
  fi
  echo "rollout of $NEW_TD not settled yet ($(jq -r '.rolloutState' <<<"$SUMMARY"), $(jq -r '.running' <<<"$SUMMARY")/$(jq -r '.desired' <<<"$SUMMARY") running, $(jq -r '.deployments' <<<"$SUMMARY") deployment(s)); checking again in ${INTERVAL}s"
  sleep "$INTERVAL"
done
