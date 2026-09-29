# Private, short-lived evidence foundation. No resources are created at the
# default `proctoring_infrastructure_enabled = false`. Do not apply this module
# until the existing live App Runner service/IAM roles have been imported.
locals {
  proctoring_count        = var.proctoring_infrastructure_enabled ? 1 : 0
  proctoring_worker_count = var.proctoring_infrastructure_enabled && var.proctoring_worker_image_uri != "" ? 1 : 0
  # Once provisioned, the worker drains already-confirmed work even when new
  # cloud inference admission is turned off in App Runner.
  proctoring_consume_count = local.proctoring_worker_count
  proctoring_alarm_actions = var.proctoring_alarm_topic_arn == "" ? [] : [var.proctoring_alarm_topic_arn]
}

resource "aws_kms_key" "proctoring_evidence" {
  count                   = local.proctoring_count
  description             = "TIMS proctoring evidence; S3 use only"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = { Component = "proctoring" }
}

resource "aws_kms_alias" "proctoring_evidence" {
  count         = local.proctoring_count
  name          = "alias/${var.service_name}-proctoring-evidence"
  target_key_id = aws_kms_key.proctoring_evidence[0].key_id
}

resource "aws_s3_bucket" "proctoring_evidence" {
  count         = local.proctoring_count
  bucket        = var.proctoring_evidence_bucket_name
  force_destroy = false
  tags          = { Component = "proctoring" }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.aws_region == "us-west-2"
      error_message = "Initial proctoring evidence must stay in us-west-2 alongside the API/database."
    }
    precondition {
      condition     = length(var.proctoring_evidence_bucket_name) >= 3 && length(var.proctoring_evidence_bucket_name) <= 63
      error_message = "Set a globally unique, 3-63 character proctoring_evidence_bucket_name before enabling."
    }
    precondition {
      condition     = length(var.proctoring_upload_origins) > 0
      error_message = "Set at least one exact HTTPS proctoring_upload_origins entry before enabling."
    }
    precondition {
      condition     = length(var.proctoring_budget_email) > 3
      error_message = "Set proctoring_budget_email so the monthly cost alert has a recipient."
    }
  }
}

resource "aws_s3_bucket_public_access_block" "proctoring_evidence" {
  count                   = local.proctoring_count
  bucket                  = aws_s3_bucket.proctoring_evidence[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "proctoring_evidence" {
  count  = local.proctoring_count
  bucket = aws_s3_bucket.proctoring_evidence[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "proctoring_evidence" {
  count  = local.proctoring_count
  bucket = aws_s3_bucket.proctoring_evidence[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.proctoring_evidence[0].arn
    }
    bucket_key_enabled = true
  }
}

# API deletion is the precise seven-day control; lifecycle is an asynchronous
# backstop. Versioning is deliberately never enabled. If importing a versioned
# bucket, the noncurrent-version rule prevents hidden surviving media versions.
resource "aws_s3_bucket_lifecycle_configuration" "proctoring_evidence" {
  count  = local.proctoring_count
  bucket = aws_s3_bucket.proctoring_evidence[0].id

  rule {
    id     = "staging-one-day"
    status = "Enabled"
    filter { prefix = "staging/" }
    expiration { days = 1 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }

  rule {
    id     = "sealed-seven-days"
    status = "Enabled"
    filter { prefix = "sealed/" }
    expiration { days = 7 }
    noncurrent_version_expiration { noncurrent_days = 1 }
  }
}

# The browser only receives a per-object, short-lived POST or reviewer GET URL
# from .NET. Exact origins and the POST form's x-amz headers are allowed here;
# there are no browser AWS credentials and no wildcard origin.
resource "aws_s3_bucket_cors_configuration" "proctoring_evidence" {
  count  = local.proctoring_count
  bucket = aws_s3_bucket.proctoring_evidence[0].id
  cors_rule {
    allowed_methods = ["POST", "GET", "HEAD"]
    allowed_origins = var.proctoring_upload_origins
    allowed_headers = ["Content-Type", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

data "aws_iam_policy_document" "proctoring_bucket" {
  count = local.proctoring_count
  statement {
    sid     = "DenyCleartextTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.proctoring_evidence[0].arn,
      "${aws_s3_bucket.proctoring_evidence[0].arn}/*",
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

  # Default encryption covers ordinary uploads/copies. Refuse explicit request
  # overrides that would replace it with SSE-S3 or an unrelated KMS key.
  statement {
    sid       = "DenyExplicitNonKmsEncryption"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.proctoring_evidence[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Null"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["false"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid       = "DenyExplicitWrongKmsKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.proctoring_evidence[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Null"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = ["false"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.proctoring_evidence[0].arn]
    }
  }

  # An explicit `aws:kms` upload without a key ID can select the AWS-managed
  # aws/s3 key instead of this bucket's customer-managed default. Ordinary
  # requests with no encryption headers still use the configured CMK.
  statement {
    sid       = "DenyExplicitKmsWithoutApprovedKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.proctoring_evidence[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
    condition {
      test     = "Null"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = ["true"]
    }
  }

  # SSE-C overrides bucket default encryption using customer-supplied keys.
  # It is never part of TIMS's consented-media storage contract.
  statement {
    sid       = "DenyCustomerProvidedEncryptionKeys"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.proctoring_evidence[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Null"
      variable = "s3:x-amz-server-side-encryption-customer-algorithm"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "proctoring_evidence" {
  count      = local.proctoring_count
  bucket     = aws_s3_bucket.proctoring_evidence[0].id
  policy     = data.aws_iam_policy_document.proctoring_bucket[0].json
  depends_on = [aws_s3_bucket_public_access_block.proctoring_evidence]
}
