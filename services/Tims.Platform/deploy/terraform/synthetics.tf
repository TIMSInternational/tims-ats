# --- External uptime checks: CloudWatch Synthetics heartbeat canaries ---------------------------------
# Three canaries probe production from outside the service, every 5 minutes, with no new vendor:
#   web    -> var.synthetics_web_url               (a public careers page on the web app)
#   health -> var.synthetics_api_base_url + /health (C# liveness: process up, no dependency checks)
#   ready  -> var.synthetics_api_base_url + /ready  (C# readiness: DB reachable; 503 when it is not)
# Each canary has one alarm on its SuccessPercent metric, routed to the platform alarms SNS topic.
#
# OPT-IN (`enable_synthetics`, default false), like alarms.tf. The URLs are variables with an empty
# default so a disabled module needs no values; preconditions below refuse an apply that enables the
# canaries without them. No hostname is committed to this repository.
#
# SNS topic: by default the alarms publish to aws_sns_topic.alarms[0] — the same topic alarms.tf uses,
# which requires enable_alarms = true. The live topic was created out-of-band by
# scripts/ops/create-alarms.sh (this module has never been applied), so `synthetics_alarm_topic_arn`
# lets an operator point the canary alarms at that existing topic instead of having Terraform create a
# second one with the same name.
#
# The canary script is canary/uptime.js (shared by all three canaries; TARGET_URL differs).

locals {
  synthetics_enabled = var.enable_synthetics

  # Pinned on purpose: a runtime upgrade changes the Node/Chromium the canary runs on and must be a
  # reviewed change. syn-nodejs-puppeteer-13.1+ is required for the @aws/* module names in uptime.js.
  synthetics_runtime_version = "syn-nodejs-puppeteer-16.1"

  # Canary names: <= 21 chars, lowercase letters, digits, hyphens and underscores only.
  synthetics_canaries = {
    web = {
      name        = "${var.synthetics_name_prefix}-web"
      url         = var.synthetics_web_url
      description = "Public web careers page did not return 2xx"
    }
    health = {
      name        = "${var.synthetics_name_prefix}-health"
      url         = "${trimsuffix(var.synthetics_api_base_url, "/")}/health"
      description = "C# API /health (liveness) did not return 2xx"
    }
    ready = {
      name        = "${var.synthetics_name_prefix}-ready"
      url         = "${trimsuffix(var.synthetics_api_base_url, "/")}/ready"
      description = "C# API /ready (DB readiness) did not return 2xx"
    }
  }

  synthetics_alarm_topic_arn = (
    var.synthetics_alarm_topic_arn != ""
    ? var.synthetics_alarm_topic_arn
    : one(aws_sns_topic.alarms[*].arn)
  )

  # Globally unique by default (account id suffix); try() keeps a disabled module (count = 0) valid.
  synthetics_bucket_name = (
    var.synthetics_artifacts_bucket_name != ""
    ? var.synthetics_artifacts_bucket_name
    : try("${var.service_name}-synthetics-${data.aws_caller_identity.synthetics[0].account_id}", "")
  )
  synthetics_artifacts_prefix = "canary"
}

data "aws_caller_identity" "synthetics" {
  count = local.synthetics_enabled ? 1 : 0
}

data "aws_partition" "synthetics" {
  count = local.synthetics_enabled ? 1 : 0
}

# --- Canary code --------------------------------------------------------------------------------------
# Node.js Synthetics runtimes load the handler from nodejs/node_modules/<file>.js inside the zip.
data "archive_file" "synthetics_uptime" {
  count = local.synthetics_enabled ? 1 : 0
  type  = "zip"
  # Content-addressed path: aws_synthetics_canary has no source hash attribute and only notices a code
  # change when zip_file changes, so the script's md5 is part of the file name.
  output_path = "${path.module}/.build/synthetics-uptime-${filemd5("${path.module}/canary/uptime.js")}.zip"

  source {
    content  = file("${path.module}/canary/uptime.js")
    filename = "nodejs/node_modules/uptime.js"
  }
}

# --- Artifacts bucket (screenshots/HAR/logs the runtime writes per run) ---------------------------------
resource "aws_s3_bucket" "synthetics_artifacts" {
  count  = local.synthetics_enabled ? 1 : 0
  bucket = local.synthetics_bucket_name
  # Holds only expiring run artifacts, so removing the canaries must not stall on a non-empty bucket.
  force_destroy = true
}

resource "aws_s3_bucket_ownership_controls" "synthetics_artifacts" {
  count  = local.synthetics_enabled ? 1 : 0
  bucket = aws_s3_bucket.synthetics_artifacts[0].id

  rule {
    object_ownership = "BucketOwnerEnforced" # ACLs disabled
  }
}

resource "aws_s3_bucket_public_access_block" "synthetics_artifacts" {
  count                   = local.synthetics_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.synthetics_artifacts[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "synthetics_artifacts" {
  count  = local.synthetics_enabled ? 1 : 0
  bucket = aws_s3_bucket.synthetics_artifacts[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "synthetics_artifacts" {
  count  = local.synthetics_enabled ? 1 : 0
  bucket = aws_s3_bucket.synthetics_artifacts[0].id

  rule {
    id     = "expire-canary-artifacts"
    status = "Enabled"

    filter {}

    expiration {
      days = var.synthetics_artifact_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "synthetics_artifacts_bucket" {
  count = local.synthetics_enabled ? 1 : 0

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.synthetics_artifacts[0].arn,
      "${aws_s3_bucket.synthetics_artifacts[0].arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "synthetics_artifacts" {
  count  = local.synthetics_enabled ? 1 : 0
  bucket = aws_s3_bucket.synthetics_artifacts[0].id
  policy = data.aws_iam_policy_document.synthetics_artifacts_bucket[0].json

  depends_on = [aws_s3_bucket_public_access_block.synthetics_artifacts]
}

# --- Least-privilege canary execution role -----------------------------------------------------------
# The permissions CloudWatch Synthetics documents for a canary role, each scoped as narrowly as the API
# allows: write to this bucket's prefix only, logs only to the canaries' own Lambda log groups, metrics
# only into the CloudWatchSynthetics namespace. s3:ListAllMyBuckets cannot be scoped below "*" (it is an
# account-level list) and is required by the runtime. No X-Ray (active tracing is off).
data "aws_iam_policy_document" "synthetics_assume" {
  count = local.synthetics_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "synthetics" {
  count              = local.synthetics_enabled ? 1 : 0
  name               = "${var.synthetics_name_prefix}-canary"
  assume_role_policy = data.aws_iam_policy_document.synthetics_assume[0].json
}

data "aws_iam_policy_document" "synthetics_canary" {
  count = local.synthetics_enabled ? 1 : 0

  statement {
    sid       = "WriteRunArtifacts"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.synthetics_artifacts[0].arn}/${local.synthetics_artifacts_prefix}/*"]
  }

  statement {
    sid       = "LocateArtifactsBucket"
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.synthetics_artifacts[0].arn]
  }

  statement {
    sid       = "ListBucketsRequiredByRuntime"
    actions   = ["s3:ListAllMyBuckets"]
    resources = ["*"]
  }

  statement {
    sid     = "WriteOwnLogs"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "arn:${data.aws_partition.synthetics[0].partition}:logs:${var.aws_region}:${data.aws_caller_identity.synthetics[0].account_id}:log-group:/aws/lambda/cwsyn-${var.synthetics_name_prefix}-*",
      "arn:${data.aws_partition.synthetics[0].partition}:logs:${var.aws_region}:${data.aws_caller_identity.synthetics[0].account_id}:log-group:/aws/lambda/cwsyn-${var.synthetics_name_prefix}-*:log-stream:*",
    ]
  }

  statement {
    sid       = "PutSyntheticsMetricsOnly"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["CloudWatchSynthetics"]
    }
  }
}

resource "aws_iam_role_policy" "synthetics_canary" {
  count  = local.synthetics_enabled ? 1 : 0
  name   = "${var.synthetics_name_prefix}-canary"
  role   = aws_iam_role.synthetics[0].id
  policy = data.aws_iam_policy_document.synthetics_canary[0].json
}

# --- The canaries --------------------------------------------------------------------------------------
resource "aws_synthetics_canary" "uptime" {
  for_each = local.synthetics_enabled ? local.synthetics_canaries : {}

  name                 = each.value.name
  runtime_version      = local.synthetics_runtime_version
  handler              = "uptime.handler"
  zip_file             = data.archive_file.synthetics_uptime[0].output_path
  execution_role_arn   = aws_iam_role.synthetics[0].arn
  artifact_s3_location = "s3://${aws_s3_bucket.synthetics_artifacts[0].id}/${local.synthetics_artifacts_prefix}/"
  start_canary         = true
  delete_lambda        = true # destroying a canary must not orphan its Lambda function

  success_retention_period = var.synthetics_artifact_retention_days
  failure_retention_period = var.synthetics_artifact_retention_days

  schedule {
    expression = "rate(5 minutes)"
  }

  run_config {
    timeout_in_seconds = 60
    memory_in_mb       = 960
    active_tracing     = false
    environment_variables = {
      TARGET_URL = each.value.url
      STEP_NAME  = each.key
    }
  }

  artifact_config {
    s3_encryption {
      encryption_mode = "SSE_S3"
    }
  }

  lifecycle {
    precondition {
      condition     = can(regex("^https://[^/\\s]+", each.value.url))
      error_message = "enable_synthetics = true requires synthetics_web_url and synthetics_api_base_url to be https:// URLs."
    }
    precondition {
      condition     = can(regex("^[a-z0-9_-]{1,21}$", each.value.name))
      error_message = "Canary names must be at most 21 chars of [a-z0-9_-]; shorten synthetics_name_prefix."
    }
  }

  # Every bucket setting is listed, not just the ones the canary needs to write: the owner applies with
  # -target on the alarms, which creates only the target's dependency closure. Nothing else references the
  # lifecycle or ownership controls, so without these two the targeted apply would skip them silently
  # (and the artifacts would never expire).
  depends_on = [
    aws_iam_role_policy.synthetics_canary,
    aws_s3_bucket_policy.synthetics_artifacts,
    aws_s3_bucket_server_side_encryption_configuration.synthetics_artifacts,
    aws_s3_bucket_lifecycle_configuration.synthetics_artifacts,
    aws_s3_bucket_ownership_controls.synthetics_artifacts,
  ]
}

# --- One alarm per canary -> the platform alarms SNS topic ---------------------------------------------
# Fires when SuccessPercent is below 100 in 2 consecutive 5-minute periods (two failed runs in a row),
# which avoids paging on one transient network blip. Missing data is BREACHING: a canary that stops
# running is itself an outage of the monitor and must page, not go quiet.
resource "aws_cloudwatch_metric_alarm" "synthetics" {
  for_each = local.synthetics_enabled ? local.synthetics_canaries : {}

  alarm_name          = "${local.alarm_prefix}-uptime-${each.key}"
  alarm_description   = "${each.value.description} in 2 consecutive 5-minute runs (CloudWatch Synthetics canary ${each.value.name})."
  namespace           = "CloudWatchSynthetics"
  metric_name         = "SuccessPercent"
  dimensions          = { CanaryName = aws_synthetics_canary.uptime[each.key].name }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 100
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [local.synthetics_alarm_topic_arn]
  ok_actions          = [local.synthetics_alarm_topic_arn]

  lifecycle {
    precondition {
      condition     = local.synthetics_alarm_topic_arn != null
      error_message = "enable_synthetics = true needs an SNS topic: set enable_alarms = true, or set synthetics_alarm_topic_arn to the existing platform alarms topic."
    }
  }
}
