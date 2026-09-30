#!/usr/bin/env bash
#
# create-alarms.sh — CloudWatch alarms -> SNS email for the C# platform API (App Runner).
#
#   bash scripts/ops/create-alarms.sh --email ADDR           # DRY RUN (default): read-only lookups, prints the plan
#   bash scripts/ops/create-alarms.sh --email ADDR --apply   # creates / updates the resources
#
# Options:  --email ADDR      REQUIRED (or $TIMS_ALARM_EMAIL). No default: the alert recipient is an
#                             explicit operator decision, never a personal address baked into the repo.
#           --profile NAME    (default tims-ats, or $TIMS_AWS_PROFILE)
#           --region NAME     (default us-west-2, or $TIMS_AWS_REGION)
# Thresholds (env, defaults match services/Tims.Platform/deploy/terraform/variables.tf):
#   ALARM_5XX_COUNT=10  ALARM_5XX_RATE_PERCENT=5  ALARM_LATENCY_P95_MS=3000
#   ALARM_CPU_PERCENT=85  ALARM_MEMORY_PERCENT=85
#
# ── WHY A SCRIPT AND NOT ONLY TERRAFORM ──────────────────────────────────────────────────────────
# services/Tims.Platform/deploy/terraform/alarms.tf declares the same resources behind
# `enable_alarms`, but that module has NEVER been applied to account 747814092517 (its state does not
# know the live App Runner service). This script creates the identical alarms directly, idempotently:
#   - `sns create-topic` returns the existing topic when it already exists;
#   - the email subscription is only created when that address is not already subscribed;
#   - `cloudwatch put-metric-alarm` is an upsert keyed by alarm name.
# Re-running it is safe and is how thresholds are changed. tests/governance/ops-alarms.test.ts fails
# if the alarm set here and in alarms.tf ever diverge.
#
# ⚠️ The SNS email subscription delivers NOTHING until the recipient clicks "Confirm subscription" in
# the "AWS Notification - Subscription Confirmation" email. With --apply, a subscription that is still
# pending prints a banner and the script EXITS 4 (after every alarm has been upserted), so an
# unconfirmed alert path never looks like a finished setup. Re-run after confirming: exit 0.
#
set -euo pipefail

ACCOUNT="747814092517"
SERVICE_NAME="tims-platform-api"
TOPIC_NAME="${SERVICE_NAME}-alarms"
PROFILE="${TIMS_AWS_PROFILE:-tims-ats}"
REGION="${TIMS_AWS_REGION:-us-west-2}" # NOT us-east-1 — that account holds unrelated NexaDev projects.
EMAIL="${TIMS_ALARM_EMAIL:-}"
APPLY=0
PENDING=0

ALARM_5XX_COUNT="${ALARM_5XX_COUNT:-10}"
ALARM_5XX_RATE_PERCENT="${ALARM_5XX_RATE_PERCENT:-5}"
ALARM_LATENCY_P95_MS="${ALARM_LATENCY_P95_MS:-3000}"
ALARM_CPU_PERCENT="${ALARM_CPU_PERCENT:-85}"
ALARM_MEMORY_PERCENT="${ALARM_MEMORY_PERCENT:-85}"

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
    --email)
      EMAIL="${2:-}"
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
      sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done

[[ -n "$EMAIL" ]] || die "an alert recipient is required: pass --email ADDR (or set TIMS_ALARM_EMAIL)."
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "not an email address: '$EMAIL'"
for n in "$ALARM_5XX_COUNT" "$ALARM_5XX_RATE_PERCENT" "$ALARM_LATENCY_P95_MS" "$ALARM_CPU_PERCENT" "$ALARM_MEMORY_PERCENT"; do
  [[ "$n" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "threshold is not a number: '$n'"
done
command -v aws >/dev/null || die "aws CLI not on PATH"

AWSX=(aws --profile "$PROFILE" --region "$REGION")

# In dry-run mode every MUTATING call is printed instead of executed. Read-only lookups always run.
mutate() {
  if [[ "$APPLY" -eq 1 ]]; then
    "${AWSX[@]}" "$@"
  else
    printf '  would run: aws'
    printf ' %q' "$@"
    printf '\n'
  fi
}

say ""
if [[ "$APPLY" -eq 1 ]]; then
  say "CloudWatch alarms for $SERVICE_NAME — APPLY"
else
  say "CloudWatch alarms for $SERVICE_NAME — DRY RUN (nothing will change; pass --apply to create)"
fi
say "════════════════════════════════════════════════════════════"

WHO="$("${AWSX[@]}" sts get-caller-identity --query Account --output text 2>/dev/null || true)"
if [[ "$WHO" != "$ACCOUNT" ]]; then
  [[ "$APPLY" -eq 1 ]] && die "Wrong or missing credentials: account '${WHO:-none}', need $ACCOUNT (profile $PROFILE)."
  warn "Cannot confirm account $ACCOUNT (got '${WHO:-none}'); showing the plan with placeholders."
  SERVICE_ID="<service-id>"
  TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT}:${TOPIC_NAME}"
else
  ok "Authenticated to $ACCOUNT ($REGION)"
  SERVICE_ARN="$("${AWSX[@]}" apprunner list-services \
    --query "ServiceSummaryList[?ServiceName=='$SERVICE_NAME'].ServiceArn" --output text)"
  [[ -n "$SERVICE_ARN" && "$SERVICE_ARN" != "None" ]] || die "App Runner service $SERVICE_NAME not found in $REGION"
  SERVICE_ID="${SERVICE_ARN##*/}"
  ok "Service $SERVICE_NAME  ServiceID=$SERVICE_ID"
  TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT}:${TOPIC_NAME}"
fi

# ── SNS topic + email subscription ───────────────────────────────────────────────────────────────
say ""
say "SNS topic $TOPIC_NAME"
if [[ "$APPLY" -eq 1 ]]; then
  TOPIC_ARN="$("${AWSX[@]}" sns create-topic --name "$TOPIC_NAME" --query TopicArn --output text)"
  ok "topic $TOPIC_ARN (created or already present)"
else
  mutate sns create-topic --name "$TOPIC_NAME"
fi

EXISTING_SUB=""
if [[ "$WHO" == "$ACCOUNT" ]]; then
  EXISTING_SUB="$("${AWSX[@]}" sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
    --query "Subscriptions[?Protocol=='email' && Endpoint=='$EMAIL'].SubscriptionArn | [0]" \
    --output text 2>/dev/null || true)"
fi
if [[ -n "$EXISTING_SUB" && "$EXISTING_SUB" != "None" ]]; then
  if [[ "$EXISTING_SUB" == "PendingConfirmation" ]]; then
    PENDING=1
    warn "$EMAIL is subscribed but NOT CONFIRMED — click the link in the AWS confirmation email."
  else
    ok "$EMAIL already subscribed and confirmed"
  fi
else
  mutate sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$EMAIL"
  if [[ "$APPLY" -eq 1 ]]; then
    PENDING=1
    warn "Subscription created as PendingConfirmation — $EMAIL must click the AWS confirmation link."
  fi
fi

# ── Alarms (names, metrics and thresholds mirror terraform/alarms.tf) ─────────────────────────────
DIMS=("Name=ServiceName,Value=$SERVICE_NAME" "Name=ServiceID,Value=$SERVICE_ID")
COMMON=(--namespace AWS/AppRunner --period 300 --treat-missing-data notBreaching
  --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN")

say ""
say "Alarms"

mutate cloudwatch put-metric-alarm --alarm-name "${SERVICE_NAME}-5xx-count" \
  --alarm-description "App Runner returned >= ${ALARM_5XX_COUNT} 5xx responses in 5 minutes." \
  --metric-name 5xxStatusResponses --statistic Sum --dimensions "${DIMS[@]}" \
  --threshold "$ALARM_5XX_COUNT" --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 --datapoints-to-alarm 1 "${COMMON[@]}"

mutate cloudwatch put-metric-alarm --alarm-name "${SERVICE_NAME}-latency-p95" \
  --alarm-description "p95 request latency above ${ALARM_LATENCY_P95_MS} ms for 15 minutes." \
  --metric-name RequestLatency --extended-statistic p95 --dimensions "${DIMS[@]}" \
  --threshold "$ALARM_LATENCY_P95_MS" --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 --datapoints-to-alarm 3 "${COMMON[@]}"

mutate cloudwatch put-metric-alarm --alarm-name "${SERVICE_NAME}-cpu-high" \
  --alarm-description "Average CPU above ${ALARM_CPU_PERCENT}% for 15 minutes." \
  --metric-name CPUUtilization --statistic Average --dimensions "${DIMS[@]}" \
  --threshold "$ALARM_CPU_PERCENT" --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 --datapoints-to-alarm 3 "${COMMON[@]}"

mutate cloudwatch put-metric-alarm --alarm-name "${SERVICE_NAME}-memory-high" \
  --alarm-description "Average memory above ${ALARM_MEMORY_PERCENT}% for 15 minutes." \
  --metric-name MemoryUtilization --statistic Average --dimensions "${DIMS[@]}" \
  --threshold "$ALARM_MEMORY_PERCENT" --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 --datapoints-to-alarm 3 "${COMMON[@]}"

# Metric math: the 5xx share of requests, only evaluated when a period has >= 20 requests, so a
# single failed request at 3 a.m. is not a 100% error rate. 5xxStatusResponses is absent until the
# first 5xx, hence FILL(err, 0).
METRIC_DIMS="[{\"Name\":\"ServiceName\",\"Value\":\"$SERVICE_NAME\"},{\"Name\":\"ServiceID\",\"Value\":\"$SERVICE_ID\"}]"
RATE_METRICS="[
  {\"Id\":\"rate\",\"Expression\":\"IF(req >= 20, 100 * FILL(err, 0) / req, 0)\",\"Label\":\"5xx rate (%)\",\"ReturnData\":true},
  {\"Id\":\"err\",\"MetricStat\":{\"Metric\":{\"Namespace\":\"AWS/AppRunner\",\"MetricName\":\"5xxStatusResponses\",\"Dimensions\":$METRIC_DIMS},\"Period\":300,\"Stat\":\"Sum\"},\"ReturnData\":false},
  {\"Id\":\"req\",\"MetricStat\":{\"Metric\":{\"Namespace\":\"AWS/AppRunner\",\"MetricName\":\"Requests\",\"Dimensions\":$METRIC_DIMS},\"Period\":300,\"Stat\":\"Sum\"},\"ReturnData\":false}
]"
mutate cloudwatch put-metric-alarm --alarm-name "${SERVICE_NAME}-5xx-rate" \
  --alarm-description "5xx responses above ${ALARM_5XX_RATE_PERCENT}% of requests in 2 of 3 five-minute periods (only when >= 20 requests/period)." \
  --metrics "$RATE_METRICS" \
  --threshold "$ALARM_5XX_RATE_PERCENT" --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 --datapoints-to-alarm 2 --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN"

say ""
if [[ "$APPLY" -eq 1 ]]; then
  "${AWSX[@]}" cloudwatch describe-alarms --alarm-name-prefix "${SERVICE_NAME}-" \
    --query 'MetricAlarms[].[AlarmName,StateValue]' --output text
  if [[ "$PENDING" -eq 1 ]]; then
    printf '\n' >&2
    printf '  ################################################################################\n' >&2
    printf '  ##  ALERTING IS NOT LIVE: the SNS subscription for %s\n' "$EMAIL" >&2
    printf '  ##  is PendingConfirmation. NO alarm reaches anyone until the link in the\n' >&2
    printf '  ##  "AWS Notification - Subscription Confirmation" email is clicked.\n' >&2
    printf '  ##  Confirm it, re-run this script (exit 0), then run the end-to-end test\n' >&2
    printf '  ##  in docs/runbooks/production-rollback-and-alerting.md section 4.1.\n' >&2
    printf '  ################################################################################\n' >&2
    exit 4
  fi
  ok "Done. The subscription is confirmed. Now run the end-to-end alarm test (runbook section 4.1)."
else
  say "Dry run only. Re-run with --apply to create/update these resources."
fi
