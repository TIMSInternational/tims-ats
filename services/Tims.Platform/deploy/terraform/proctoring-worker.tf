# The existing App Runner instance role gets only the object/queue calls that
# .NET needs. This module may not own the live role yet: import/reconcile it
# before apply, and do not attach this policy out-of-band to an unknown role.
data "aws_iam_policy_document" "proctoring_api" {
  count = local.proctoring_count

  statement {
    sid     = "WriteStagingAndSealedEvidence"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.proctoring_evidence[0].arn}/staging/*",
      "${aws_s3_bucket.proctoring_evidence[0].arn}/sealed/*",
    ]
  }
  statement {
    sid     = "ReadAndDeleteBoundedEvidence"
    actions = ["s3:GetObject", "s3:DeleteObject"]
    resources = [
      "${aws_s3_bucket.proctoring_evidence[0].arn}/staging/*",
      "${aws_s3_bucket.proctoring_evidence[0].arn}/sealed/*",
    ]
  }
  statement {
    sid       = "UseEvidenceKmsViaS3"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [aws_kms_key.proctoring_evidence[0].arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${var.aws_region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "SendInferenceRequests"
    actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.proctoring_request[0].arn]
  }
  statement {
    sid = "ConsumeInferenceResults"
    actions = [
      "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.proctoring_result[0].arn]
  }
}

resource "aws_iam_role_policy" "proctoring_api" {
  count  = local.proctoring_count
  name   = "${var.service_name}-proctoring-evidence"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.proctoring_api[0].json
}

data "aws_iam_policy_document" "proctoring_lambda_assume" {
  count = local.proctoring_count
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proctoring_worker" {
  count              = local.proctoring_count
  name               = "${var.service_name}-proctoring-worker"
  assume_role_policy = data.aws_iam_policy_document.proctoring_lambda_assume[0].json
  tags               = { Component = "proctoring" }
}

data "aws_iam_policy_document" "proctoring_worker" {
  count = local.proctoring_count
  statement {
    sid       = "ReadSealedEvidenceOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.proctoring_evidence[0].arn}/sealed/*"]
  }
  statement {
    sid       = "DecryptEvidenceViaS3"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.proctoring_evidence[0].arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${var.aws_region}.amazonaws.com"]
    }
  }
  statement {
    sid = "ReceiveInferenceRequests"
    actions = [
      "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.proctoring_request[0].arn]
  }
  statement {
    sid       = "SendInferenceResults"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.proctoring_result[0].arn]
  }
  # DetectFaces has no resource-level image ARN. Restrict the operation and region;
  # the worker itself receives only a sealed bucket key, never DB credentials.
  statement {
    sid       = "DetectFacesInOregonOnly"
    actions   = ["rekognition:DetectFaces"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.aws_region]
    }
  }
}

resource "aws_iam_role_policy" "proctoring_worker" {
  count  = local.proctoring_count
  name   = "${var.service_name}-proctoring-worker"
  role   = aws_iam_role.proctoring_worker[0].id
  policy = data.aws_iam_policy_document.proctoring_worker[0].json
}

resource "aws_ecr_repository" "proctoring_worker" {
  count                = local.proctoring_count
  name                 = "${var.service_name}-proctoring-worker"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
  tags = { Component = "proctoring" }
}

resource "aws_ecr_lifecycle_policy" "proctoring_worker" {
  count      = local.proctoring_count
  repository = aws_ecr_repository.proctoring_worker[0].name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged worker images after 14 days"
      selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }
      action       = { type = "expire" }
    }]
  })
}

# No Lambda exists until a separately built image is pinned by digest. There
# is no NAT gateway, VPC attachment, standing GPU, or runtime model download.
resource "aws_cloudwatch_log_group" "proctoring_worker" {
  count             = local.proctoring_worker_count
  name              = "/aws/lambda/${var.service_name}-proctoring-inference"
  retention_in_days = 7
  tags              = { Component = "proctoring" }
}

data "aws_iam_policy_document" "proctoring_worker_logs" {
  count = local.proctoring_worker_count
  statement {
    sid       = "WriteOwnWorkerLogsOnly"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.proctoring_worker[0].arn}:*"]
  }
}

resource "aws_iam_role_policy" "proctoring_worker_logs" {
  count  = local.proctoring_worker_count
  name   = "${var.service_name}-proctoring-worker-logs"
  role   = aws_iam_role.proctoring_worker[0].id
  policy = data.aws_iam_policy_document.proctoring_worker_logs[0].json
}

resource "aws_lambda_function" "proctoring_worker" {
  count                          = local.proctoring_worker_count
  function_name                  = "${var.service_name}-proctoring-inference"
  package_type                   = "Image"
  image_uri                      = var.proctoring_worker_image_uri
  role                           = aws_iam_role.proctoring_worker[0].arn
  architectures                  = ["x86_64"]
  timeout                        = 90
  memory_size                    = 2048
  reserved_concurrent_executions = 2
  ephemeral_storage { size = 1024 }
  environment {
    variables = {
      EVIDENCE_BUCKET            = aws_s3_bucket.proctoring_evidence[0].bucket
      RESULT_QUEUE_URL           = aws_sqs_queue.proctoring_result[0].url
      PROCTORING_MODEL_REVISION  = var.proctoring_model_revision
      AWS_EVIDENCE_REGION        = var.aws_region
      HF_OBJECT_DETECTOR_ENABLED = tostring(var.proctoring_hf_detector_enabled)
    }
  }
  depends_on = [
    aws_iam_role_policy.proctoring_worker,
    aws_iam_role_policy.proctoring_worker_logs,
    aws_cloudwatch_log_group.proctoring_worker,
  ]
  tags = { Component = "proctoring" }

  lifecycle {
    precondition {
      condition     = var.proctoring_model_revision != ""
      error_message = "Pin the evaluated proctoring_model_revision before creating the worker Lambda."
    }
    precondition {
      condition     = startswith(var.proctoring_worker_image_uri, "${aws_ecr_repository.proctoring_worker[0].repository_url}@sha256:")
      error_message = "The worker image digest must come from this Terraform-managed ECR repository in the same account and region."
    }
  }
}

# Keep the event source active while the pinned worker exists. The App Runner
# cloud-inference flag only controls admission of new evidence; turning it off
# must not strand confirmed outbox messages already sent to this queue.
resource "aws_lambda_event_source_mapping" "proctoring_request" {
  count                   = local.proctoring_consume_count
  event_source_arn        = aws_sqs_queue.proctoring_request[0].arn
  function_name           = aws_lambda_function.proctoring_worker[0].arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
  enabled                 = true
  scaling_config { maximum_concurrency = 2 }
}
