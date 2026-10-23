#!/usr/bin/env bash
#
# create-workers-service.sh — the AWS side of the Tims.Workers deployment (single-replica ECS Fargate).
#
#   bash scripts/deploy/create-workers-service.sh                          # DRY RUN (default): read-only lookups, prints the plan
#   bash scripts/deploy/create-workers-service.sh --apply                  # creates repo, log group, roles, cluster, security group
#   bash scripts/deploy/create-workers-service.sh --apply --image-tag abc1234
#                                                                          # ...and registers the task definition + creates/updates the service
#   bash scripts/deploy/create-workers-service.sh --apply --stop           # kill switch: desired count 0 (scheduler stops, nothing deleted)
#
# Options:  --profile NAME    (default tims-ats, or $TIMS_AWS_PROFILE)
#           --region NAME     (default us-west-2, or $TIMS_AWS_REGION)
#           --image-tag TAG   short-SHA tag already pushed to the tims-platform-workers ECR repo
#           --fx-refresh BOOL Workers__FxRefreshEnabled for a NEW task definition (default true)
#           --hris-sync BOOL  Workers__HrisSyncEnabled for a NEW task definition (default false — see runbook)
#           --stop            set the service's desired count to 0
# Sizing (env): WORKERS_CPU=256  WORKERS_MEMORY=512
#
# Procedure, env vars, double-execution analysis and rollback: docs/runbooks/workers-deploy.md.
#
# ── WHY ECS FARGATE AND NOT APP RUNNER ────────────────────────────────────────────────────────────
# Tims.Workers is a Quartz scheduler, not a request server. App Runner allocates CPU to an instance only
# while it is serving a request, so a 05:00 UTC cron fire would run throttled; and App Runner rolls out by
# running the old and new instance side by side, i.e. two in-memory (RAMJobStore) schedulers at once. ECS
# with desiredCount=1, minimumHealthyPercent=0, maximumPercent=100 stops the old task BEFORE starting the
# new one, so a recurring trigger can never fire from two replicas.
#
# ── IDEMPOTENT ────────────────────────────────────────────────────────────────────────────────────
# Every create is preceded by a read-only lookup and skipped when the resource exists. Re-running with a
# different --image-tag registers a new task-definition revision and points the service at it — that is
# the manual deploy AND rollback path. When the service already exists, the new revision is a COPY of the
# live one with only the image swapped (scripts/deploy/workers-next-td.py), plus --fx-refresh/--hris-sync
# when passed explicitly; a rollback never resets the live env, cron settings or secret references to this
# script's defaults. The defaults below apply only to the FIRST revision of a new service.
#
# Nothing here reads a secret VALUE. The DB connection string is injected by ECS from the EXISTING
# Secrets Manager secret the API already uses (tims-platform-api/DatabaseConnectionString).
#
set -euo pipefail

ACCOUNT="747814092517"
PROFILE="${TIMS_AWS_PROFILE:-tims-ats}"
REGION="${TIMS_AWS_REGION:-us-west-2}" # NOT us-east-1 — that account holds unrelated NexaDev projects.
NAME="tims-platform-workers"
ECR_REPO="$NAME"
CLUSTER="tims-platform"
SERVICE="$NAME"
CONTAINER="$NAME"
LOG_GROUP="/ecs/$NAME"
EXECUTION_ROLE="${NAME}-execution"
TASK_ROLE="${NAME}-task"
SG_NAME="${NAME}-egress-only"
# The LIVE name (read from the running App Runner service 2026-10-01). terraform/main.tf would name it
# tims-platform-api/Platform__DatabaseConnectionString, but that module was never applied — do not "fix" this to match it.
DB_SECRET_NAME="tims-platform-api/DatabaseConnectionString"
CPU="${WORKERS_CPU:-256}"
MEMORY="${WORKERS_MEMORY:-512}"
IMAGE_TAG=""
FX_REFRESH="true"
HRIS_SYNC="false"
FX_SET=0
HRIS_SET=0
APPLY=0
STOP=0

say() { printf '%s\n' "$*"; }
ok() { printf '  ok   %s\n' "$*"; }
warn() { printf '  warn %s\n' "$*" >&2; }
die() {
  printf '  FAIL %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --stop) STOP=1 ;;
    --image-tag)
      IMAGE_TAG="${2:-}"
      shift
      ;;
    --fx-refresh)
      FX_REFRESH="${2:-}"
      FX_SET=1
      shift
      ;;
    --hris-sync)
      HRIS_SYNC="${2:-}"
      HRIS_SET=1
      shift
      ;;
    --profile)
      PROFILE="${2:-}"
      shift
      ;;
    --region)
      REGION="${2:-}"
      shift
      ;;
    -h | --help)
      sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done

[[ -z "$IMAGE_TAG" || "$IMAGE_TAG" =~ ^[0-9a-f]{7,40}$ ]] || die "--image-tag must be a commit short SHA (got '$IMAGE_TAG')"
[[ "$FX_REFRESH" == "true" || "$FX_REFRESH" == "false" ]] || die "--fx-refresh must be true or false"
[[ "$HRIS_SYNC" == "true" || "$HRIS_SYNC" == "false" ]] || die "--hris-sync must be true or false"
[[ "$CPU" =~ ^[0-9]+$ && "$MEMORY" =~ ^[0-9]+$ ]] || die "WORKERS_CPU / WORKERS_MEMORY must be integers"
[[ "$STOP" -eq 0 || -z "$IMAGE_TAG" ]] || die "--stop and --image-tag are mutually exclusive"
command -v aws >/dev/null || die "aws CLI not on PATH"
command -v python3 >/dev/null || die "python3 not on PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AWSX=(aws --profile "$PROFILE" --region "$REGION")
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# In dry-run mode every MUTATING call is printed instead of executed. Read-only lookups always run.
# Apply-mode stdout (AWS's JSON echo) is discarded; errors still reach stderr and abort (set -e).
mutate() {
  if [[ "$APPLY" -eq 1 ]]; then
    "${AWSX[@]}" "$@" >/dev/null
  else
    printf '  would run: aws'
    printf ' %q' "$@"
    printf '\n'
  fi
}

say ""
if [[ "$APPLY" -eq 1 ]]; then
  say "Tims.Workers on ECS Fargate — APPLY"
else
  say "Tims.Workers on ECS Fargate — DRY RUN (nothing will change; pass --apply)"
fi
say "════════════════════════════════════════════════════════════"

WHO="$("${AWSX[@]}" sts get-caller-identity --query Account --output text 2>/dev/null || true)"
ONLINE=0
if [[ "$WHO" != "$ACCOUNT" ]]; then
  [[ "$APPLY" -eq 1 ]] && die "Wrong or missing credentials: account '${WHO:-none}', need $ACCOUNT (profile $PROFILE)."
  warn "Cannot confirm account $ACCOUNT (got '${WHO:-none}'); showing the plan with placeholders."
else
  ONLINE=1
  ok "Authenticated to $ACCOUNT ($REGION)"
fi

# Serialise with deploy-platform-workers.yml, which holds the same lock from its decision through its roll:
# without it, an automatic run that decided before this script ran would overwrite what this script rolls
# (scripts/deploy/workers-deploy-lock.sh). Released on exit, whatever the outcome.
if [[ "$APPLY" -eq 1 ]]; then
  LOCK_USER="$(id -un)"
  LOCK_HOLDER="owner-${LOCK_USER//[^A-Za-z0-9._-]/_}-$$"
  lock() { AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" bash "$SCRIPT_DIR/workers-deploy-lock.sh" "$1" "$LOCK_HOLDER"; }
  lock acquire || die "could not take the workers deploy lock (see above); nothing changed"
  trap 'lock release || true; rm -rf "$WORK"' EXIT
fi

# ── Kill switch ──────────────────────────────────────────────────────────────────────────────────
if [[ "$STOP" -eq 1 ]]; then
  say ""
  say "Stopping the scheduler (desired count 0). The service, image and roles are kept."
  mutate ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count 0
  [[ "$APPLY" -eq 1 ]] && ok "desired count 0 — re-enable with --apply --image-tag <tag>"
  exit 0
fi

# ── 1. ECR repository (immutable tags, scan on push, keep the last 30 images) ────────────────────
say ""
say "1. ECR repository $ECR_REPO"
if [[ "$ONLINE" -eq 1 ]] && "${AWSX[@]}" ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  ok "exists"
else
  mutate ecr create-repository --repository-name "$ECR_REPO" \
    --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true
fi
# put-lifecycle-policy is an upsert: re-assert it on every run, not only on create, so a repo that
# already existed (or was hand-edited) still ends up with this retention.
# ECR counts by PUSH time, so "keep the last 30" alone can expire the RUNNING image: failed rolls leave
# newer images behind, and a rollback restores an older image without refreshing its push time. So every
# image a deploy rolls onto or away from is tagged `deployed-<tag>` (scripts/deploy/workers-protect-image.sh),
# and rule 1 selects that prefix. ECR never lets a lower-priority rule expire an image that a higher-priority
# rule selected, so deployed images are kept (for 3650 days) and only never-deployed builds age out at 30.
mutate ecr put-lifecycle-policy --repository-name "$ECR_REPO" --lifecycle-policy-text \
  '{"rules":[{"rulePriority":1,"description":"never expire an image that was deployed (running or rollback target)","selection":{"tagStatus":"tagged","tagPrefixList":["deployed-"],"countType":"sinceImagePushed","countUnit":"days","countNumber":3650},"action":{"type":"expire"}},{"rulePriority":2,"description":"keep the last 30 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":30},"action":{"type":"expire"}}]}'

# ── 2. Log group (30-day retention — job logs carry no payloads/PII by design) ───────────────────
say ""
say "2. CloudWatch log group $LOG_GROUP"
EXISTING_LG=""
if [[ "$ONLINE" -eq 1 ]]; then
  EXISTING_LG="$("${AWSX[@]}" logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
    --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName | [0]" --output text 2>/dev/null || true)"
fi
if [[ "$EXISTING_LG" == "$LOG_GROUP" ]]; then
  ok "exists"
else
  mutate logs create-log-group --log-group-name "$LOG_GROUP"
fi
# Re-asserted on every run (idempotent): a pre-existing group defaults to NEVER EXPIRE otherwise.
mutate logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 30

# ── 3. The DB secret the API already uses (looked up, never read) ────────────────────────────────
say ""
say "3. Secret $DB_SECRET_NAME (reused from the API — value is never read here)"
DB_SECRET_ARN="arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${DB_SECRET_NAME}-XXXXXX"
if [[ "$ONLINE" -eq 1 ]]; then
  DB_SECRET_ARN="$("${AWSX[@]}" secretsmanager describe-secret --secret-id "$DB_SECRET_NAME" \
    --query ARN --output text 2>/dev/null || true)"
  [[ "$DB_SECRET_ARN" == arn:aws:secretsmanager:* ]] || die "secret $DB_SECRET_NAME not found in $REGION"
  ok "$DB_SECRET_ARN"
fi

# ── 4. IAM: execution role (pull image, write logs, inject the DB secret) + task role (no grants) ─
say ""
say "4. IAM roles $EXECUTION_ROLE / $TASK_ROLE"
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"aws:SourceAccount":"'"$ACCOUNT"'"}}}]}'
# Never shrink the live policy: a roll or rollback must not strip grants the owner added for secrets the task
# definition still references (scripts/deploy/workers-exec-policy.py). Unreadable live policy = stop.
LIVE_EXEC_POLICY=""
if [[ "$ONLINE" -eq 1 ]]; then
  if POLICY_OUT="$("${AWSX[@]}" iam get-role-policy --role-name "$EXECUTION_ROLE" --policy-name "${NAME}-execution" \
    --query PolicyDocument --output json 2>&1)"; then
    printf '%s' "$POLICY_OUT" >"$WORK/live-exec-policy.json"
    LIVE_EXEC_POLICY="$WORK/live-exec-policy.json"
  elif ! grep -q NoSuchEntity <<<"$POLICY_OUT"; then
    die "cannot read $EXECUTION_ROLE's policy; refusing to overwrite it blind: $POLICY_OUT"
  fi
fi
EXEC_POLICY="$(python3 "$SCRIPT_DIR/workers-exec-policy.py" "$REGION" "$ACCOUNT" "$ECR_REPO" "$LOG_GROUP" \
  "$DB_SECRET_ARN" ${LIVE_EXEC_POLICY:+"$LIVE_EXEC_POLICY"})" || die "could not build the execution role policy"
python3 -c 'import json,sys; json.loads(sys.argv[1]); json.loads(sys.argv[2])' "$TRUST" "$EXEC_POLICY" \
  || die "generated IAM JSON does not parse"
for ROLE in "$EXECUTION_ROLE" "$TASK_ROLE"; do
  if [[ "$ONLINE" -eq 1 ]] && "${AWSX[@]}" iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    ok "role $ROLE exists"
  else
    mutate iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" \
      --description "Tims.Workers ECS task ($ROLE)"
  fi
done
# put-role-policy is an upsert: re-running re-asserts the exact grant.
mutate iam put-role-policy --role-name "$EXECUTION_ROLE" --policy-name "${NAME}-execution" \
  --policy-document "$EXEC_POLICY"
say "  (the task role deliberately carries NO policy: the jobs call no AWS API — Email is disabled)"

# ── 5. Cluster ───────────────────────────────────────────────────────────────────────────────────
say ""
say "5. ECS cluster $CLUSTER"
CLUSTER_STATUS=""
if [[ "$ONLINE" -eq 1 ]]; then
  CLUSTER_STATUS="$("${AWSX[@]}" ecs describe-clusters --clusters "$CLUSTER" \
    --query 'clusters[0].status' --output text 2>/dev/null || true)"
fi
if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
  ok "exists"
else
  mutate ecs create-cluster --cluster-name "$CLUSTER" --capacity-providers FARGATE
fi

# ── 6. Network: default VPC, public subnets, an egress-only security group ──────────────────────
# The task needs OUTBOUND only (Supabase pooler, open.er-api.com, BambooHR). Nothing connects to it, so the
# security group has no inbound rule. A public IP on a default-VPC subnet avoids a NAT gateway (~$32/mo).
say ""
say "6. Network (default VPC, egress-only security group $SG_NAME)"
VPC_ID="<default-vpc>"
SUBNETS="<subnet-a>,<subnet-b>"
SG_ID="<sg-id>"
if [[ "$ONLINE" -eq 1 ]]; then
  VPC_ID="$("${AWSX[@]}" ec2 describe-vpcs --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text 2>/dev/null || true)"
  [[ "$VPC_ID" == vpc-* ]] || die "no default VPC in $REGION — create one or adapt the subnets by hand"
  SUBNETS="$("${AWSX[@]}" ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
    --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
  [[ -n "$SUBNETS" && "$SUBNETS" != "None" ]] || die "no default subnets in $VPC_ID"
  ok "vpc $VPC_ID subnets $SUBNETS"
  SG_ID="$("${AWSX[@]}" ec2 describe-security-groups \
    --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$SG_NAME" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
fi
if [[ "$SG_ID" == sg-* ]]; then
  ok "security group $SG_ID exists"
elif [[ "$APPLY" -eq 1 ]]; then
  SG_ID="$("${AWSX[@]}" ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "Tims.Workers: egress only, no inbound" --query GroupId --output text)"
  ok "security group $SG_ID created (default egress-all, no inbound)"
else
  mutate ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "Tims.Workers: egress only, no inbound"
fi

if [[ -z "$IMAGE_TAG" ]]; then
  say ""
  say "Foundation only (no --image-tag). Next:"
  say "  a) bash scripts/deploy/bootstrap-github-oidc-role.sh        (adds the workers grants to the deploy role)"
  say "  b) gh variable set PLATFORM_WORKERS_DEPLOY_ENABLED --body true"
  say "  c) gh workflow run 'Deploy platform workers' --ref main -f reason='first workers image'"
  say "  d) re-run this script with --apply --image-tag <the short SHA the workflow pushed>"
  exit 0
fi

# ── 7. Task definition ───────────────────────────────────────────────────────────────────────────
say ""
say "7. Task definition $NAME (image tag $IMAGE_TAG)"
if [[ "$ONLINE" -eq 1 ]]; then
  "${AWSX[@]}" ecr describe-images --repository-name "$ECR_REPO" --image-ids imageTag="$IMAGE_TAG" >/dev/null 2>&1 \
    || die "image $ECR_REPO:$IMAGE_TAG is not in ECR — push it first (Deploy platform workers workflow)"
  ok "image $ECR_REPO:$IMAGE_TAG present"
fi
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
TD_FILE="$WORK/task-definition.json"
# An existing service: copy its LIVE revision and swap only the image (+ explicit overrides). Never rebuild
# from defaults, or a rollback would re-enable a disabled job and drop custom env and secret references.
LIVE_TD=""
if [[ "$ONLINE" -eq 1 ]]; then
  # Fail closed: only a service that positively does not exist may fall back to defaults. A throttled,
  # denied or failed lookup must stop the run, never be read as "no service" (that would rebuild the
  # definition from defaults and update the EXISTING service with it).
  LIVE_STATUS="$(AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" ECS_CLUSTER="$CLUSTER" ECS_SERVICE="$SERVICE" \
    bash "$SCRIPT_DIR/workers-service-status.sh")" || die "cannot tell whether $SERVICE exists; refusing to build a task definition from defaults"
  if [[ "$LIVE_STATUS" == "ACTIVE" ]]; then
    LIVE_TD="$("${AWSX[@]}" ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
      --query 'services[0].taskDefinition' --output text)" || die "cannot read the live task definition of $SERVICE"
    [[ "$LIVE_TD" == arn:aws:ecs:* ]] || die "unexpected live task definition '$LIVE_TD' for $SERVICE"
  fi
fi
OVERRIDES=()
[[ "$FX_SET" -eq 1 ]] && OVERRIDES+=("Workers__FxRefreshEnabled=$FX_REFRESH")
[[ "$HRIS_SET" -eq 1 ]] && OVERRIDES+=("Workers__HrisSyncEnabled=$HRIS_SYNC")
# Sizing applies to an existing service only when set explicitly; otherwise the live size is kept.
[[ -n "${WORKERS_CPU:-}" ]] && OVERRIDES+=("task.cpu=$CPU")
[[ -n "${WORKERS_MEMORY:-}" ]] && OVERRIDES+=("task.memory=$MEMORY")
if [[ -n "$LIVE_TD" ]]; then
  "${AWSX[@]}" ecs describe-task-definition --task-definition "$LIVE_TD" --query 'taskDefinition' \
    --output json > "$WORK/live-td.json" || die "cannot read $LIVE_TD"
  python3 "$SCRIPT_DIR/workers-next-td.py" "$WORK/live-td.json" "$TD_FILE" "$CONTAINER" "$IMAGE" ${OVERRIDES[@]+"${OVERRIDES[@]}"} \
    || die "could not derive the next task definition from $LIVE_TD"
  say "  copying the live revision $LIVE_TD: image -> $IMAGE_TAG; overrides: ${OVERRIDES[*]:-none}"
else
[[ "$ONLINE" -eq 1 ]] || warn "offline: if the service already exists, --apply copies its LIVE revision instead of the definition below"
python3 - "$TD_FILE" <<PY
import json, sys
td = {
  "family": "$NAME",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "$CPU",
  "memory": "$MEMORY",
  "runtimePlatform": {"cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX"},
  "executionRoleArn": "arn:aws:iam::$ACCOUNT:role/$EXECUTION_ROLE",
  "taskRoleArn": "arn:aws:iam::$ACCOUNT:role/$TASK_ROLE",
  "containerDefinitions": [{
    "name": "$CONTAINER",
    "image": "$IMAGE",
    "essential": True,
    # Quartz WaitForJobsToComplete: give an in-flight FX/HRIS fire time to finish on SIGTERM.
    "stopTimeout": 120,
    "readonlyRootFilesystem": False,
    # tini as PID 1: without it, dotnet IS PID 1 and an abort() (unhandled crash) is ignored by the kernel,
    # leaving a spinning, never-exiting task. Reproduced locally 2026-10-12 (docker run vs docker run --init).
    "linuxParameters": {"initProcessEnabled": True},
    "environment": [
      {"name": "ASPNETCORE_ENVIRONMENT", "value": "Production"},
      {"name": "Platform__ServiceName", "value": "$NAME"},
      {"name": "Workers__FxRefreshEnabled", "value": "$FX_REFRESH"},
      {"name": "Workers__HrisSyncEnabled", "value": "$HRIS_SYNC"},
      {"name": "Workers__ClusteredSchedulerEnabled", "value": "false"},
      {"name": "Email__Enabled", "value": "false"},
    ],
    "secrets": [
      {"name": "Platform__DatabaseConnectionString", "valueFrom": "$DB_SECRET_ARN"},
    ],
    "healthCheck": {
      "command": ["CMD", "dotnet", "Tims.Workers.dll", "--healthcheck"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60,
    },
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "$LOG_GROUP",
        "awslogs-region": "$REGION",
        "awslogs-stream-prefix": "workers",
      },
    },
  }],
}
json.dump(td, open(sys.argv[1], "w"), indent=2)
PY
say "  new service, first revision — env: Workers__FxRefreshEnabled=$FX_REFRESH Workers__HrisSyncEnabled=$HRIS_SYNC ClusteredScheduler=false  cpu=$CPU mem=$MEMORY"
fi
TD_ARN="<task-definition-arn>"
if [[ "$APPLY" -eq 1 ]]; then
  TD_ARN="$("${AWSX[@]}" ecs register-task-definition --cli-input-json "file://$TD_FILE" \
    --query 'taskDefinition.taskDefinitionArn' --output text)"
  ok "registered $TD_ARN"
else
  say "  would run: aws ecs register-task-definition --cli-input-json file://<generated, shown below>"
  sed 's/^/    /' "$TD_FILE"
fi

# ── 8. Service: exactly one task, never two at once ──────────────────────────────────────────────
say ""
say "8. ECS service $SERVICE (desired 1, minHealthy 0%, max 100% — no overlapping schedulers)"
SERVICE_STATUS=""
if [[ "$ONLINE" -eq 1 ]]; then
  SERVICE_STATUS="$("${AWSX[@]}" ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].status' --output text 2>/dev/null || true)"
fi
DEPLOY_CFG='maximumPercent=100,minimumHealthyPercent=0,deploymentCircuitBreaker={enable=true,rollback=true}'
NET_CFG="awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG_ID}],assignPublicIp=ENABLED}"
# Protect the image BEFORE the service points at it, so the running image (and, on a rollback, the image
# being restored) can never be aged out by the 30-image count.
if [[ "$APPLY" -eq 1 ]]; then
  command -v jq >/dev/null || die "jq not on PATH (needed to protect the image and to verify the roll)"
  AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" ECR_REPO="$ECR_REPO" \
    bash "$SCRIPT_DIR/workers-protect-image.sh" "$IMAGE_TAG" \
    || die "could not protect $ECR_REPO:$IMAGE_TAG from expiry; not rolling onto it"
else
  say "  would run: scripts/deploy/workers-protect-image.sh $IMAGE_TAG   (adds tag deployed-$IMAGE_TAG)"
fi
if [[ "$SERVICE_STATUS" == "ACTIVE" ]]; then
  mutate ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$TD_ARN" \
    --desired-count 1 --deployment-configuration "$DEPLOY_CFG"
else
  mutate ecs create-service --cluster "$CLUSTER" --service-name "$SERVICE" --task-definition "$TD_ARN" \
    --desired-count 1 --launch-type FARGATE --platform-version LATEST \
    --deployment-configuration "$DEPLOY_CFG" --network-configuration "$NET_CFG" \
    --no-enable-execute-command --propagate-tags SERVICE
fi
if [[ "$APPLY" -eq 1 ]]; then
  say "  waiting for the service to stabilise…"
  "${AWSX[@]}" ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" \
    || die "service did not stabilise — check: aws ecs describe-services --cluster $CLUSTER --services $SERVICE"
  # services-stable ALSO returns 0 after a circuit-breaker rollback (stable again, on the OLD revision), so
  # the waiter alone cannot say the requested image runs. Same verifier as the workflow: it polls until the
  # PRIMARY deployment is $TD_ARN with rolloutState COMPLETED, and fails loud on a rollback or FAILED.
  AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" ECS_CLUSTER="$CLUSTER" ECS_SERVICE="$SERVICE" \
    bash "$SCRIPT_DIR/workers-verify-roll.sh" "$TD_ARN" \
    || die "service $SERVICE did NOT settle on $TD_ARN ($IMAGE_TAG); if the circuit breaker rolled back, the previous revision still runs. Check: aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].events[:10]'"
  ok "service $SERVICE runs $IMAGE_TAG ($TD_ARN, rollout COMPLETED)"
  say ""
  say "Verify (docs/runbooks/workers-deploy.md §Verify): the first log lines in $LOG_GROUP, then the next"
  say "05:00 UTC 'fx refresh' line, BEFORE turning the API's Platform__FxRefreshEnabled off."
fi
