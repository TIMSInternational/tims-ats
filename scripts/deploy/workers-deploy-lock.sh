#!/usr/bin/env bash
# Serialises the two paths that mutate the workers ECS service: deploy-platform-workers.yml (decide → build →
# roll, minutes apart) and create-workers-service.sh --apply (the owner's manual roll / rollback / stop).
# GitHub's `concurrency:` only serialises workflow runs, so without this an automatic run that decided on
# commit B could, after its build, overwrite a newer commit C the owner rolled meanwhile (tier-1 review).
#
# The lock is one item, pk `lock#workers-deploy`, in the shared DynamoDB table `tims-ats-ratelimit`
# (on-demand, deletion-protected, TTL on expiresAt). Taking it is one conditional PutItem: it succeeds only if
# no lock exists or the existing one has expired, so it is atomic, and unlike an SSM parameter (which cannot
# be re-created for ~30 s after a delete) it can be re-taken the moment it is released. A holder that dies
# frees the lock when it expires (LOCK_TTL_SECONDS, longer than the 45-minute workflow job). The deploy role
# may touch only this item (IAM dynamodb:LeadingKeys, scripts/deploy/bootstrap-github-oidc-role.sh).
#
#   workers-deploy-lock.sh acquire <holder>   wait up to LOCK_WAIT_SECONDS (default 1200) for the lock
#   workers-deploy-lock.sh renew <holder>     extend the lease, only if <holder> still holds it unexpired;
#                                             fails (exit 1) when the lease was lost. Both paths call it
#                                             right before they mutate ECS, so a holder that stalled past
#                                             its lease (a suspended laptop) can never write after someone
#                                             else took the lock (tier-1 review).
#   workers-deploy-lock.sh release <holder>   release it, only if <holder> is the one holding it
#
# Any error other than "someone holds it" fails closed: no lock, no deploy.
set -euo pipefail

TABLE="${WORKERS_DEPLOY_LOCK_TABLE:-tims-ats-ratelimit}"
KEY='{"pk":{"S":"lock#workers-deploy"}}'
REGION="${AWS_REGION:-us-west-2}"
WAIT="${LOCK_WAIT_SECONDS:-1200}"
INTERVAL="${LOCK_INTERVAL_SECONDS:-15}"
TTL="${LOCK_TTL_SECONDS:-3600}"
cmd="${1:-}"
holder="${2:-}"

fail() { echo "workers-deploy-lock: $*" >&2; exit 2; }
[[ "$holder" =~ ^[A-Za-z0-9@._:-]{1,120}$ ]] || fail "holder must be a short id (got '$holder')"
[[ "$WAIT" =~ ^[0-9]+$ && "$INTERVAL" =~ ^[0-9]+$ && "$TTL" =~ ^[1-9][0-9]*$ ]] \
  || fail "LOCK_WAIT_SECONDS, LOCK_INTERVAL_SECONDS and LOCK_TTL_SECONDS must be whole seconds"

holder_now() {
  aws dynamodb get-item --region "$REGION" --table-name "$TABLE" --key "$KEY" --consistent-read \
    --query 'Item.[holder.S, expiresAt.N]' --output text 2>/dev/null || echo '?'
}

case "$cmd" in
  acquire)
    deadline=$(($(date +%s) + WAIT))
    while :; do
      now=$(date +%s)
      item="{\"pk\":{\"S\":\"lock#workers-deploy\"},\"holder\":{\"S\":\"$holder\"},\"expiresAt\":{\"N\":\"$((now + TTL))\"}}"
      if err="$(aws dynamodb put-item --region "$REGION" --table-name "$TABLE" --item "$item" \
        --condition-expression 'attribute_not_exists(pk) OR expiresAt < :now' \
        --expression-attribute-values "{\":now\":{\"N\":\"$now\"}}" 2>&1 >/dev/null)"; then
        echo "workers deploy lock acquired by $holder (expires in ${TTL}s if never released)"
        exit 0
      fi
      if ! grep -q ConditionalCheckFailedException <<<"$err"; then
        echo "$err" >&2
        echo "workers-deploy-lock: cannot take the lock in $TABLE (not because someone holds it); refusing to deploy" >&2
        exit 1
      fi
      current="$(holder_now)"
      if (($(date +%s) >= deadline)); then
        echo "workers-deploy-lock: the lock is still held by '$current' (holder, expiry epoch) after ${WAIT}s." >&2
        echo "If that run or script is gone, clear it: aws dynamodb delete-item --region $REGION --table-name $TABLE --key '$KEY'" >&2
        exit 1
      fi
      echo "waiting for the workers deploy lock (held by '$current')"
      sleep "$INTERVAL"
    done
    ;;
  renew)
    now=$(date +%s)
    if err="$(aws dynamodb update-item --region "$REGION" --table-name "$TABLE" --key "$KEY" \
      --update-expression 'SET expiresAt = :exp' \
      --condition-expression 'holder = :me AND expiresAt >= :now' \
      --expression-attribute-values "{\":me\":{\"S\":\"$holder\"},\":now\":{\"N\":\"$now\"},\":exp\":{\"N\":\"$((now + TTL))\"}}" 2>&1 >/dev/null)"; then
      echo "workers deploy lock renewed by $holder"
      exit 0
    fi
    if grep -q ConditionalCheckFailedException <<<"$err"; then
      echo "workers-deploy-lock: $holder no longer holds the lock (now '$(holder_now)'): it expired or was cleared. Not deploying." >&2
    else
      echo "$err" >&2
    fi
    exit 1
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
  *) fail "usage: workers-deploy-lock.sh acquire|renew|release <holder>" ;;
esac
