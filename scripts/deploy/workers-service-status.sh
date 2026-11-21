#!/usr/bin/env bash
# Print the ECS status of the workers service, for deploy-platform-workers.yml's `decide` step.
# Tested by tests/governance/workers-deploy-facts.test.ts (with a fake `aws` on PATH).
#
# Prints exactly one of: ACTIVE | DRAINING | INACTIVE | MISSING, and exits 0.
# MISSING is printed ONLY for the two answers that really mean "there is no service yet":
#   - describe-services succeeded, returned no service, and every failure entry has reason MISSING;
#   - describe-services failed with ClusterNotFoundException (the cluster itself does not exist).
# EVERY other outcome (AccessDenied, throttling, an expired OIDC session, a network error, unparseable
# output, an unknown status) exits 1 with an ::error::. The earlier inline version ran
# `... 2>/dev/null || true` and folded all of those into MISSING, which made an automatic run report
# "no ECS service yet" and finish green while production kept the old code.
#
# Inputs (environment): AWS_REGION, ECS_CLUSTER, ECS_SERVICE.
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}" "${ECS_CLUSTER:?ECS_CLUSTER is required}" "${ECS_SERVICE:?ECS_SERVICE is required}"

die() { echo "::error::workers-service-status: $*" >&2; exit 1; }

ERR_FILE="$(mktemp)"
trap 'rm -f "$ERR_FILE"' EXIT

if OUT="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
             --services "$ECS_SERVICE" --output json 2>"$ERR_FILE")"; then
  N_SERVICES="$(jq -er '.services | length' <<<"$OUT" 2>/dev/null)" \
    || die "describe-services returned unparseable output; refusing to treat it as 'no service'."
  if [ "$N_SERVICES" = "0" ]; then
    # A service that does not exist comes back as services:[] + failures:[{reason:"MISSING"}].
    if jq -e '(.failures | length) > 0 and all(.failures[]; .reason == "MISSING")' <<<"$OUT" >/dev/null 2>&1; then
      echo "MISSING"
      exit 0
    fi
    die "describe-services returned no service and failures other than MISSING: $(jq -c '.failures' <<<"$OUT" 2>/dev/null || echo '?')"
  fi
  STATUS="$(jq -er '.services[0].status' <<<"$OUT" 2>/dev/null)" || die "describe-services returned a service with no status."
  case "$STATUS" in
    ACTIVE | DRAINING | INACTIVE) echo "$STATUS" ;;
    *) die "unexpected service status '$STATUS'." ;;
  esac
  exit 0
fi

if grep -q 'ClusterNotFoundException' "$ERR_FILE"; then
  echo "MISSING"
  exit 0
fi

cat "$ERR_FILE" >&2
die "cannot read the ECS service $ECS_CLUSTER/$ECS_SERVICE (see the error above); refusing to treat a failed call as 'no service'."
