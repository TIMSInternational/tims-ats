#!/usr/bin/env bash
# Serialises the two paths that mutate the workers ECS service and its IAM: deploy-platform-workers.yml (decide →
# build → roll, minutes apart) and create-workers-service.sh --apply (the owner's roll / rollback / stop).
# GitHub's `concurrency:` only serialises workflow runs, so without this an automatic run that decided on
# commit B could, after its build, overwrite a newer commit C the owner rolled meanwhile (tier-1 review).
#
# The lock is one item, pk `lock#workers-deploy`, in the shared DynamoDB table `tims-ats-ratelimit`. Taking it
# is one conditional PutItem (attribute_not_exists), so it is atomic and can be re-taken the moment it is
# released. It NEVER EXPIRES, deliberately: IAM and ECS cannot check a fencing token, so with an expiring lease
# a holder that stalled after its last check (a suspended laptop) could still write after someone else took
# over (tier-1 review). A holder that dies therefore keeps the lock until a human confirms it is gone and
# clears it (the message below says how). The item carries no expiresAt, so the table's TTL never removes it.
# The deploy role may touch only this item (IAM dynamodb:LeadingKeys, bootstrap-github-oidc-role.sh).
#
#   workers-deploy-lock.sh acquire <holder>   wait up to LOCK_WAIT_SECONDS (default 1200) for the lock
#   workers-deploy-lock.sh release <holder>   release it, only if <holder> is the one holding it
#
# Any error other than "someone holds it" fails closed: no lock, no deploy.
set -euo pipefail

TABLE="${WORKERS_DEPLOY_LOCK_TABLE:-tims-ats-ratelimit}"
KEY='{"pk":{"S":"lock#workers-deploy"}}'
REGION="${AWS_REGION:-us-west-2}"
WAIT="${LOCK_WAIT_SECONDS:-1200}"
INTERVAL="${LOCK_INTERVAL_SECONDS:-15}"
cmd="${1:-}"
holder="${2:-}"

fail() { echo "workers-deploy-lock: $*" >&2; exit 2; }
[[ "$holder" =~ ^[A-Za-z0-9@._:-]{1,120}$ ]] || fail "holder must be a short id (got '$holder')"
[[ "$WAIT" =~ ^[0-9]+$ && "$INTERVAL" =~ ^[0-9]+$ ]] || fail "LOCK_WAIT_SECONDS and LOCK_INTERVAL_SECONDS must be whole seconds"

holder_now() {
  aws dynamodb get-item --region "$REGION" --table-name "$TABLE" --key "$KEY" --consistent-read \
    --query 'Item.[holder.S, since.S]' --output text 2>/dev/null || echo '?'
}

case "$cmd" in
  acquire)
    deadline=$(($(date +%s) + WAIT))
    item="{\"pk\":{\"S\":\"lock#workers-deploy\"},\"holder\":{\"S\":\"$holder\"},\"since\":{\"S\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}"
    while :; do
      if err="$(aws dynamodb put-item --region "$REGION" --table-name "$TABLE" --item "$item" \
        --condition-expression 'attribute_not_exists(pk)' 2>&1 >/dev/null)"; then
        echo "workers deploy lock acquired by $holder"
        exit 0
      fi
      if ! grep -q ConditionalCheckFailedException <<<"$err"; then
        echo "$err" >&2
        echo "workers-deploy-lock: cannot take the lock in $TABLE (not because someone holds it); refusing to deploy" >&2
        exit 1
      fi
      current="$(holder_now)"
      if (($(date +%s) >= deadline)); then
        echo "workers-deploy-lock: the lock is still held by '$current' (holder, since) after ${WAIT}s." >&2
        echo "It never expires. Clear it ONLY after confirming that holder has stopped (its GitHub run is finished," >&2
        echo "or its script is no longer running), then re-run:" >&2
        echo "  aws dynamodb delete-item --region $REGION --table-name $TABLE --key '$KEY'" >&2
        exit 1
      fi
      echo "waiting for the workers deploy lock (held by '$current')"
      sleep "$INTERVAL"
    done
    ;;
  release)
    if err="$(aws dynamodb delete-item --region "$REGION" --table-name "$TABLE" --key "$KEY" \
      --condition-expression 'holder = :me' \
      --expression-attribute-values "{\":me\":{\"S\":\"$holder\"}}" 2>&1 >/dev/null)"; then
      echo "workers deploy lock released by $holder"
      exit 0
    fi
    if grep -q ConditionalCheckFailedException <<<"$err"; then
      echo "workers-deploy-lock: $holder does not hold the lock (held by '$(holder_now)'); leaving it" >&2
      exit 0
    fi
    echo "$err" >&2
    exit 1
    ;;
  *) fail "usage: workers-deploy-lock.sh acquire|release <holder>" ;;
esac
