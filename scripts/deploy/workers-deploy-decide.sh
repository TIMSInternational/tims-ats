#!/usr/bin/env bash
# Decide, BEFORE anything is built, whether deploy-platform-workers.yml pushes an image and whether it
# rolls the ECS service onto it. Pure: no AWS, no git, no network — the workflow gathers the facts and
# passes them in, so every branch is unit-tested (tests/governance/workers-deploy-decide.test.ts).
#
# WHY this exists: the ECR repo keeps only the last 30 images of any tag. Pushing on every green
# `.NET Platform CI` run and only THEN deciding not to roll expired the RUNNING image after ~30 CI-path
# merges, so the next task replacement or rollback failed with CannotPullContainerError. Invariant:
#   push=true  ⇒  roll=true, or a manual dispatch seeding the first image before the service exists.
#
# Inputs (environment; every value is validated, a malformed one exits 2 without printing a decision):
#   EVENT             workflow_run | workflow_dispatch
#   SERVICE_STATUS    ECS service status (ACTIVE, or anything else / MISSING when it does not exist)
#   TAG               the short SHA this run would deploy
#   RUNNING_TAG       the image tag the live task definition runs ('' when there is no service)
#   IMAGE_EXISTS      true | false — TAG is already in ECR
#   RUNNING_IS_NEWER  true | false | unknown — TAG's commit is an ancestor of the running commit
#   GRAPH_CHANGED     true | false | unknown — the workers project graph differs between the two commits
#   DESIRED_COUNT     the service's desiredCount        } required when SERVICE_STATUS is ACTIVE: "already
#   RUNNING_COUNT     the service's runningCount        } runs TAG" is a skip only for a HEALTHY service, so a
#   ROLLOUT_STATE     the PRIMARY deployment's rolloutState (COMPLETED | IN_PROGRESS | FAILED)  } stopped or
#                     failed one re-rolls and the roll verifier, not this shortcut, decides the run's colour
# Output (stdout): push=<true|false>, roll=<true|false>, reason=<one line>
set -euo pipefail

fail() { echo "workers-deploy-decide: $*" >&2; exit 2; }

case "${EVENT:-}" in workflow_run | workflow_dispatch) ;; *) fail "EVENT must be workflow_run or workflow_dispatch (got '${EVENT:-}')" ;; esac
[[ "${TAG:-}" =~ ^[0-9a-f]{7,40}$ ]] || fail "TAG must be a short SHA (got '${TAG:-}')"
case "${IMAGE_EXISTS:-}" in true | false) ;; *) fail "IMAGE_EXISTS must be true|false (got '${IMAGE_EXISTS:-}')" ;; esac
case "${RUNNING_IS_NEWER:-}" in true | false | unknown) ;; *) fail "RUNNING_IS_NEWER must be true|false|unknown" ;; esac
case "${GRAPH_CHANGED:-}" in true | false | unknown) ;; *) fail "GRAPH_CHANGED must be true|false|unknown" ;; esac
SERVICE_STATUS="${SERVICE_STATUS:-MISSING}"
RUNNING_TAG="${RUNNING_TAG:-}"
if [[ "$SERVICE_STATUS" == "ACTIVE" ]]; then
  [[ "${DESIRED_COUNT:-}" =~ ^[0-9]+$ ]] || fail "DESIRED_COUNT must be a count for an ACTIVE service (got '${DESIRED_COUNT:-}')"
  [[ "${RUNNING_COUNT:-}" =~ ^[0-9]+$ ]] || fail "RUNNING_COUNT must be a count for an ACTIVE service (got '${RUNNING_COUNT:-}')"
  case "${ROLLOUT_STATE:-}" in COMPLETED | IN_PROGRESS | FAILED) ;; *) fail "ROLLOUT_STATE must be COMPLETED|IN_PROGRESS|FAILED for an ACTIVE service (got '${ROLLOUT_STATE:-}')" ;; esac
fi

emit() {
  local roll="$1" reason="$2" push=false
  if [[ "$roll" == true || "$reason" == seed:* ]] && [[ "$IMAGE_EXISTS" == false ]]; then push=true; fi
  echo "push=$push"
  echo "roll=$roll"
  echo "reason=$reason"
  exit 0
}

if [[ "$SERVICE_STATUS" != "ACTIVE" ]]; then
  if [[ "$EVENT" == "workflow_dispatch" ]]; then
    emit false "seed: no ECS service yet (status $SERVICE_STATUS) — push $TAG for create-workers-service.sh --image-tag"
  fi
  emit false "no ECS service yet (status $SERVICE_STATUS) — automatic runs do not push; seed the first image with a manual dispatch"
fi

if [[ "$RUNNING_TAG" == "$TAG" ]]; then
  if (( DESIRED_COUNT > 0 && RUNNING_COUNT == DESIRED_COUNT )) && [[ "$ROLLOUT_STATE" == "COMPLETED" ]]; then
    emit false "the service already runs $TAG (running $RUNNING_COUNT of $DESIRED_COUNT, rollout COMPLETED)"
  fi
  # Stopped (desired 0), short of tasks, or a failed/unfinished rollout of this very tag: re-roll, so the roll
  # verifier fails a service that runs nothing and a failed first deploy can be retried.
  emit true "the service references $TAG but is not healthy (running $RUNNING_COUNT of $DESIRED_COUNT, rollout $ROLLOUT_STATE) — re-rolling so the verifier decides"
fi

if [[ "$EVENT" != "workflow_dispatch" ]]; then
  [[ "$RUNNING_IS_NEWER" == true ]] && emit false "the service runs $RUNNING_TAG, which is NEWER than $TAG — not regressing"
  [[ "$GRAPH_CHANGED" == false ]] && emit false "no change under the workers project graph since $RUNNING_TAG — not restarting the scheduler"
fi

emit true "roll from ${RUNNING_TAG:-<unknown>} to $TAG"
