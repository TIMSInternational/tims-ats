#!/usr/bin/env bash
# Verify that the workers service actually settled on the task definition the deploy registered.
# Run by deploy-platform-workers.yml right after `aws ecs wait services-stable`.
# Tested by tests/governance/workers-deploy-facts.test.ts (with a fake `aws` on PATH).
#
# WHY: the service runs with deploymentCircuitBreaker={enable=true,rollback=true}. When the new task
# never becomes healthy the breaker rolls back, the service settles again on the OLD revision (one
# deployment, runningCount == desiredCount), and `services-stable` returns 0. Without this check the job
# went green and printed "Workers rolled to <tag>" for a deploy that never happened.
#
# Passes (exit 0) only when ALL of these hold:
#   - services[0].taskDefinition == NEW_TD
#   - exactly one deployment, and it is PRIMARY with taskDefinition == NEW_TD
#   - that deployment's rolloutState == COMPLETED
#   - runningCount == desiredCount
# Anything else (including a failed or unparseable describe-services) exits 1 with an ::error::.
#
# Usage: workers-verify-roll.sh <new task definition ARN>
# Inputs (environment): AWS_REGION, ECS_CLUSTER, ECS_SERVICE.
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}" "${ECS_CLUSTER:?ECS_CLUSTER is required}" "${ECS_SERVICE:?ECS_SERVICE is required}"
NEW_TD="${1:-}"
[[ "$NEW_TD" =~ ^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task-definition/[A-Za-z0-9_-]+:[0-9]+$ ]] \
  || { echo "::error::workers-verify-roll: not a task definition ARN: '$NEW_TD'" >&2; exit 1; }

die() { echo "::error::workers-verify-roll: $*" >&2; exit 1; }

OUT="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
         --services "$ECS_SERVICE" --output json)" \
  || die "cannot read the service after the roll; the deploy is NOT verified."

SUMMARY="$(jq -ec --arg td "$NEW_TD" '
  .services[0] as $s
  | ($s.deployments // []) as $d
  | ([$d[] | select(.status == "PRIMARY")] | first) as $p
  | {
      serviceTd: $s.taskDefinition,
      deployments: ($d | length),
      primaryTd: ($p.taskDefinition // null),
      rolloutState: ($p.rolloutState // null),
      rolloutReason: ($p.rolloutStateReason // null),
      running: $s.runningCount,
      desired: $s.desiredCount,
      ok: ($s.taskDefinition == $td
           and ($d | length) == 1
           and ($p.taskDefinition // null) == $td
           and ($p.rolloutState // null) == "COMPLETED"
           and $s.runningCount == $s.desiredCount)
    }' <<<"$OUT" 2>/dev/null)" \
  || die "describe-services returned no service or unparseable output; the deploy is NOT verified."

if [ "$(jq -r '.ok' <<<"$SUMMARY")" != "true" ]; then
  die "the service did NOT settle on $NEW_TD (a circuit-breaker rollback leaves it on the previous revision). Observed: $SUMMARY"
fi
echo "verified: service runs $NEW_TD, rollout COMPLETED"
