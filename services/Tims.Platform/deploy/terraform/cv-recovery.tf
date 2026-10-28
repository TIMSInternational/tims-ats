# --- CV parse recovery (#333, PR #357): default OFF ---------------------------------------------------
# The .NET 10 API host re-parses public-application CVs whose first (TypeScript) parse failed. Nothing
# here is created and the flag stays "false" unless `cv_recovery.enabled = true`. Like the rest of this
# module it has never been applied to the real account (see the PROD DRIFT NOTICE in main.tf); the
# owner apply procedure performs the same grants with the CLI and must keep both in step.
#
# Least privilege for the instance role:
#   * s3:GetObject on the CV bucket's `cv-uploads/*` prefix only (HeadObject is authorized by GetObject).
#   * bedrock:InvokeModel (Converse) on the pinned Haiku inference profile AND every foundation-model ARN
#     it can route to — cross-region inference needs both.
#   * bedrock:ApplyGuardrail on the one guardrail; its version must be PUBLISHED (numeric), never DRAFT.
#
# Design notes (documented, not fixed): each in-flight inference holds two database connections (the
# consent-gate transaction plus the budget/usage ledger), and App Runner has no per-instance canary, so
# enabling the flag enables every instance at once — canary with a synthetic application instead.

variable "cv_recovery" {
  description = "CV parse recovery loop. Keep enabled=false until the retry migration, IAM, published guardrail, cv-parser agent activation and alarms are verified (owner apply procedure)."
  type = object({
    enabled               = optional(bool, false)
    bucket_name           = optional(string, "")
    bucket_region         = optional(string, "")
    bedrock_region        = optional(string, "")
    inference_profile_arn = optional(string, "")
    foundation_model_arns = optional(list(string), [])
    guardrail_arn         = optional(string, "")
    guardrail_id          = optional(string, "")
    guardrail_version     = optional(string, "")
    created_after         = optional(string, "") # ISO-8601 UTC activation cut-off; set it explicitly.
  })
  default = {}

  validation {
    condition = !var.cv_recovery.enabled || (
      length(var.cv_recovery.bucket_name) > 0 &&
      length(var.cv_recovery.bucket_region) > 0 &&
      length(var.cv_recovery.bedrock_region) > 0 &&
      startswith(var.cv_recovery.inference_profile_arn, "arn:aws:bedrock:") &&
      length(var.cv_recovery.foundation_model_arns) > 0 &&
      startswith(var.cv_recovery.guardrail_arn, "arn:aws:bedrock:") &&
      length(var.cv_recovery.guardrail_id) > 0 &&
      can(regex("^[1-9][0-9]{0,7}$", var.cv_recovery.guardrail_version)) &&
      can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$", var.cv_recovery.created_after))
    )
    error_message = "cv_recovery.enabled requires bucket, regions, inference profile + foundation model ARNs, guardrail ARN/id, a PUBLISHED numeric guardrail_version (not DRAFT) and an explicit created_after (UTC)."
  }
}

locals {
  cv_recovery_env = var.cv_recovery.enabled ? {
    Platform__CvParseRecoveryEnabled = "true"
    CV_UPLOADS_BUCKET                = var.cv_recovery.bucket_name
    CV_UPLOADS_REGION                = var.cv_recovery.bucket_region
    BEDROCK_AWS_REGION               = var.cv_recovery.bedrock_region
    BEDROCK_GUARDRAIL_ID             = var.cv_recovery.guardrail_id
    BEDROCK_GUARDRAIL_VERSION        = var.cv_recovery.guardrail_version
    CV_RECOVERY_CREATED_AFTER        = var.cv_recovery.created_after
    } : {
    Platform__CvParseRecoveryEnabled = "false"
  }
}

data "aws_iam_policy_document" "cv_recovery" {
  count = var.cv_recovery.enabled ? 1 : 0

  statement {
    sid       = "ReadCvUploadsOnly"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.cv_recovery.bucket_name}/cv-uploads/*"]
  }

  statement {
    sid       = "InvokePinnedHaikuProfile"
    actions   = ["bedrock:InvokeModel"]
    resources = concat([var.cv_recovery.inference_profile_arn], var.cv_recovery.foundation_model_arns)
  }

  statement {
    sid       = "ApplyCvGuardrail"
    actions   = ["bedrock:ApplyGuardrail"]
    resources = [var.cv_recovery.guardrail_arn]
  }
}

resource "aws_iam_role_policy" "instance_cv_recovery" {
  count  = var.cv_recovery.enabled ? 1 : 0
  name   = "${var.service_name}-cv-recovery"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.cv_recovery[0].json
}

# Mirrors scripts/ops/create-cv-recovery-alarm.sh (same names, tokens and semantics).
locals {
  cv_recovery_alarms_enabled = var.enable_alarms && var.cv_recovery.enabled
  cv_recovery_log_group      = "/aws/apprunner/${var.service_name}/${aws_apprunner_service.api.service_id}/application"
  cv_recovery_filters = {
    alert     = { pattern = "\"CV_RECOVERY_ALERT\"", metric = "RecoveryAlertCount" }
    heartbeat = { pattern = "\"CV_RECOVERY_HEARTBEAT\"", metric = "RecoveryHeartbeatCount" }
  }
}

resource "aws_cloudwatch_log_metric_filter" "cv_recovery" {
  for_each       = local.cv_recovery_alarms_enabled ? local.cv_recovery_filters : {}
  name           = "${local.alarm_prefix}-cv-recovery-${each.key}"
  log_group_name = local.cv_recovery_log_group
  pattern        = each.value.pattern

  metric_transformation {
    name          = each.value.metric
    namespace     = "TIMS/CvRecovery"
    value         = "1"
    default_value = "0"
  }
}

# Fires only while a problem is current; returns to OK when CV_RECOVERY_ALERT stops.
resource "aws_cloudwatch_metric_alarm" "cv_recovery_alert" {
  count               = local.cv_recovery_alarms_enabled ? 1 : 0
  alarm_name          = "${local.alarm_prefix}-cv-recovery-alert"
  alarm_description   = "CV recovery exhausted or due backlog exceeds ten minutes."
  namespace           = "TIMS/CvRecovery"
  metric_name         = "RecoveryAlertCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

# A stalled loop emits nothing: missing heartbeat for 15 minutes pages.
resource "aws_cloudwatch_metric_alarm" "cv_recovery_heartbeat" {
  count               = local.cv_recovery_alarms_enabled ? 1 : 0
  alarm_name          = "${local.alarm_prefix}-cv-recovery-heartbeat"
  alarm_description   = "CV recovery loop heartbeat missing for 15 minutes (stalled, DB unreachable or disabled)."
  namespace           = "TIMS/CvRecovery"
  metric_name         = "RecoveryHeartbeatCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}
