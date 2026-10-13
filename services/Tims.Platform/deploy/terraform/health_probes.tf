# --- IAM: read-only grants for the Health page dependency probes ------------------------------------
# GET /platform/health/dependencies (Tims.Api/PlatformHealth) makes one cheap READ per dependency. Each
# statement below is the minimum for exactly one probe call; nothing here can write, send or invoke:
#   - SES  GetAccountSendingEnabled + GetSendQuota — account-level reads; SES supports no resource scoping
#          for these two actions, hence "*".
#   - S3   HeadBucket on the CV bucket — authorised by s3:ListBucket on the BUCKET ARN only (no object
#          ARN, so no object can be read).
#   - Bedrock GetGuardrail — control plane, on the one configured guardrail ARN. No InvokeModel.
# A statement is created only when its identifier is configured (var.health_probe).

data "aws_caller_identity" "current" {}

locals {
  health_guardrail_arn = (
    var.health_probe.bedrock_guardrail_id == "" || var.health_probe.bedrock_region == "" ? "" :
    startswith(var.health_probe.bedrock_guardrail_id, "arn:") ? var.health_probe.bedrock_guardrail_id :
    "arn:aws:bedrock:${var.health_probe.bedrock_region}:${data.aws_caller_identity.current.account_id}:guardrail/${var.health_probe.bedrock_guardrail_id}"
  )
}

data "aws_iam_policy_document" "health_probes" {
  statement {
    sid       = "HealthProbeSesAccountRead"
    actions   = ["ses:GetAccountSendingEnabled", "ses:GetSendQuota"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = var.health_probe.cv_uploads_bucket == "" ? [] : [var.health_probe.cv_uploads_bucket]
    content {
      sid       = "HealthProbeCvBucketHead"
      actions   = ["s3:ListBucket"]
      resources = ["arn:aws:s3:::${statement.value}"]
    }
  }

  dynamic "statement" {
    for_each = local.health_guardrail_arn == "" ? [] : [local.health_guardrail_arn]
    content {
      sid       = "HealthProbeGuardrailRead"
      actions   = ["bedrock:GetGuardrail"]
      resources = [statement.value]
    }
  }
}

resource "aws_iam_role_policy" "instance_health_probes" {
  name   = "${var.service_name}-health-probes"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.health_probes.json
}
