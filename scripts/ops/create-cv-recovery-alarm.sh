#!/usr/bin/env bash
# Create the CV background-recovery CloudWatch log alarm. Dry run unless --apply.
# Reuses the confirmed SNS destination managed by create-alarms.sh. A missing
# subscriber is a hard stop before any mutation; an alarm without delivery is
# not an operational safeguard.
set -euo pipefail

ACCOUNT="747814092517"
SERVICE_NAME="tims-platform-api"
PROFILE="${TIMS_AWS_PROFILE:-tims-ats}"
REGION="${TIMS_AWS_REGION:-us-west-2}"
APPLY=0

say() { printf '%s\n' "$*"; }
die() { printf 'CV recovery alarm: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --profile) PROFILE="${2:-}"; shift ;;
    --region) REGION="${2:-}"; shift ;;
    -h|--help)
      say "Usage: $0 [--profile NAME] [--region NAME] [--apply]"
      say "Dry run by default. Configure and confirm the SNS email with create-alarms.sh first."
      exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

command -v aws >/dev/null || die "aws CLI not found"
AWSX=(aws --profile "$PROFILE" --region "$REGION")
WHO="$("${AWSX[@]}" sts get-caller-identity --query Account --output text)"
[[ "$WHO" == "$ACCOUNT" ]] || die "wrong AWS account; expected $ACCOUNT"
SERVICE_ARN="$("${AWSX[@]}" apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='$SERVICE_NAME'].ServiceArn" --output text)"
[[ -n "$SERVICE_ARN" && "$SERVICE_ARN" != "None" ]] || die "App Runner service not found"
SERVICE_ID="${SERVICE_ARN##*/}"
LOG_GROUP="/aws/apprunner/$SERVICE_NAME/$SERVICE_ID/application"
EXISTING_LOG_GROUP="$("${AWSX[@]}" logs describe-log-groups \
  --log-group-name-prefix "$LOG_GROUP" --query 'logGroups[0].logGroupName' --output text)"
[[ "$EXISTING_LOG_GROUP" == "$LOG_GROUP" ]] || die "application log group not found"

TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT}:${SERVICE_NAME}-alarms"
SUBSCRIPTIONS="$("${AWSX[@]}" sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[].SubscriptionArn' --output text)"
CONFIRMED=0
for subscription in $SUBSCRIPTIONS; do
  if [[ "$subscription" == arn:aws:sns:* && "$subscription" != "PendingConfirmation" ]]; then
    CONFIRMED=1
  fi
done
if [[ "$APPLY" -eq 1 && "$CONFIRMED" -ne 1 ]]; then
  die "SNS topic has no confirmed subscription; run create-alarms.sh and confirm the email first"
fi

FILTER_NAME="${SERVICE_NAME}-cv-recovery-alert"
ALARM_NAME="${SERVICE_NAME}-cv-recovery-alert"
FILTER_PATTERN='"CV_RECOVERY_ALERT"'
TRANSFORM="metricName=RecoveryAlertCount,metricNamespace=TIMS/CvRecovery,metricValue=1,defaultValue=0"

say "CV recovery alarm in $ACCOUNT/$REGION, log group $LOG_GROUP"
if [[ "$CONFIRMED" -ne 1 ]]; then
  say "No confirmed SNS subscriber yet; --apply will refuse until the alert path is live."
fi
if [[ "$APPLY" -eq 0 ]]; then
  say "Dry run: would create metric filter $FILTER_NAME and alarm $ALARM_NAME."
  exit 0
fi

"${AWSX[@]}" logs put-metric-filter --log-group-name "$LOG_GROUP" \
  --filter-name "$FILTER_NAME" --filter-pattern "$FILTER_PATTERN" \
  --metric-transformations "$TRANSFORM"
"${AWSX[@]}" cloudwatch put-metric-alarm --alarm-name "$ALARM_NAME" \
  --alarm-description 'CV recovery exhausted or due backlog exceeds ten minutes.' \
  --namespace TIMS/CvRecovery --metric-name RecoveryAlertCount --statistic Sum \
  --period 300 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 --datapoints-to-alarm 1 --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN"
say "Created metric filter and alarm. Verify SNS delivery with a controlled test before enabling recovery."
