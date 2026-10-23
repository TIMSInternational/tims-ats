#!/usr/bin/env bash
# Serialises the two paths that mutate the workers ECS service: deploy-platform-workers.yml (decide → build →
# roll, minutes apart) and create-workers-service.sh --apply (the owner's manual roll / rollback / stop).
# GitHub's `concurrency:` only serialises workflow runs, so without this an automatic run that decided on
# commit B could, after its build, overwrite a newer commit C the owner rolled meanwhile (tier-1 review).
#
# The lock is an SSM parameter created WITHOUT --overwrite: PutParameter fails with ParameterAlreadyExists
# while someone holds it, which makes taking it atomic. Its value is "<holder> <UTC time>".
#
#   workers-deploy-lock.sh acquire <holder>   wait up to LOCK_WAIT_SECONDS (default 1200) for the lock
#   workers-deploy-lock.sh release <holder>   release it, only if <holder> is the one holding it
#
# Any error other than "already held" fails closed: no lock, no deploy.
set -euo pipefail

NAME="${WORKERS_DEPLOY_LOCK_PARAM:-/tims-ats/workers/deploy-lock}"
REGION="${AWS_REGION:-us-west-2}"
WAIT="${LOCK_WAIT_SECONDS:-1200}"
INTERVAL="${LOCK_INTERVAL_SECONDS:-15}"
cmd="${1:-}"
holder="${2:-}"

fail() { echo "workers-deploy-lock: $*" >&2; exit 2; }
[[ "$holder" =~ ^[A-Za-z0-9@._:-]{1,120}$ ]] || fail "holder must be a short id (got '$holder')"
[[ "$WAIT" =~ ^[0-9]+$ && "$INTERVAL" =~ ^[0-9]+$ ]] || fail "LOCK_WAIT_SECONDS and LOCK_INTERVAL_SECONDS must be whole seconds"

case "$cmd" in
  acquire)
    deadline=$(($(date +%s) + WAIT))
    while :; do
      if err="$(aws ssm put-parameter --region "$REGION" --name "$NAME" --type String \
        --value "$holder $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>&1 >/dev/null)"; then
        echo "workers deploy lock acquired by $holder"
        exit 0
      fi
      if ! grep -q ParameterAlreadyExists <<<"$err"; then
        echo "$err" >&2
        echo "workers-deploy-lock: cannot take $NAME (not because someone holds it); refusing to deploy" >&2
        exit 1
      fi
      current="$(aws ssm get-parameter --region "$REGION" --name "$NAME" --query Parameter.Value --output text 2>/dev/null || echo '?')"
      if (($(date +%s) >= deadline)); then
        echo "workers-deploy-lock: $NAME has been held by '$current' for over ${WAIT}s." >&2
        echo "If that run or script is gone, clear it: aws ssm delete-parameter --region $REGION --name $NAME" >&2
        exit 1
      fi
      echo "waiting for the workers deploy lock (held by '$current')"
      sleep "$INTERVAL"
    done
    ;;
  release)
    if ! current="$(aws ssm get-parameter --region "$REGION" --name "$NAME" --query Parameter.Value --output text 2>&1)"; then
      grep -q ParameterNotFound <<<"$current" && exit 0
      echo "$current" >&2
      exit 1
    fi
    if [[ "${current%% *}" != "$holder" ]]; then
      echo "workers-deploy-lock: the lock is held by '$current', not $holder; leaving it" >&2
      exit 0
    fi
    aws ssm delete-parameter --region "$REGION" --name "$NAME" >/dev/null
    echo "workers deploy lock released by $holder"
    ;;
  *) fail "usage: workers-deploy-lock.sh acquire|release <holder>" ;;
esac
