############################################################################################
# TIMS C# Platform (Tims.Api) — AWS App Runner deploy (Gate G3).
# Pairs with docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md.
# The image must be built + pushed to ECR FIRST (runbook §3); this module references it by tag.
#
# ⚠️  PROD DRIFT NOTICE (2026-07-27) — READ BEFORE THE FIRST REAL `terraform apply` ⚠️
# This module has (per the runbook) likely NEVER been applied against real AWS infrastructure.
# However `Platform__TeamIntelReadEnabled` is CONFIRMED LIVE in real production TODAY, flipped
# manually OUT-OF-BAND (not via this module — see CORS/CSP fix commits #183/#184, 2026-07-24, and
# the runbook's 2026-07-27 update). That almost certainly means an `aws_apprunner_service` named
# `var.service_name` ("tims-platform-api") ALREADY EXISTS in the account, unmanaged by Terraform.
#
# Before ever running `terraform apply` for real, a human MUST:
#   1. Check whether the App Runner service (and its ECR repo / secrets / IAM roles) already exist
#      out-of-band. `terraform plan` against a fresh/empty state will otherwise try to CREATE
#      resources that already exist → either a duplicate-name API error, or worse, a successful
#      create that fights the real one.
#   2. If they exist, `terraform import` each real resource into this module's state BEFORE the
#      first `apply`, so Terraform reconciles with reality instead of trying to recreate/replace it.
#   3. Confirm `terraform.tfvars` sets `team_intel_read = true` (see terraform.tfvars.example) —
#      the code-level default in variables.tf is `false` by design (safe-by-default IaC), so an
#      operator who forgets this WILL silently revert the live flag to false on apply, breaking a
#      feature real users already depend on.
# This is exactly the class of Terraform-vs-reality drift that causes production incidents.
############################################################################################

locals {
  tags = merge({
    Project     = "tims-ats"
    Service     = "tims-platform-api"
    Component   = "csharp-backend"
    Environment = "production"
    ManagedBy   = "terraform"
    Compliance  = "SOC2-ISO27001"
  }, var.tags)

  # Secret CONTAINERS created here; VALUES populated out-of-band (never in TF state).
  # key => the env var name the .NET service reads (Platform:X binds from Platform__X).
  base_secrets = {
    db            = "Platform__DatabaseConnectionString"
    redis         = "Platform__RedisConnectionString"
    impersonation = "Platform__ImpersonationSecret"
    # #172: the alert-evaluation cron's credential for the CROSS-ORG metric surface. It is the entire
    # authorization boundary for a caller that may name any organization, so it lives here rather than in
    # a flag. Unset => that surface refuses every request (CronCallerGate fails closed), so creating the
    # container before populating it is safe. Must match the web app's ALERT_METRICS_CRON_SECRET, which is
    # a DIFFERENT value from Vercel's CRON_SECRET (that one authenticates Vercel to the Next.js route).
    alert_metrics_cron = "Platform__AlertMetricsCronSecret"
  }
  stripe_secrets = var.manage_stripe_secrets ? {
    stripe_key   = "Stripe__SecretKey"
    stripe_whsec = "Stripe__WebhookSecret"
  } : {}
  all_secrets = merge(local.base_secrets, local.stripe_secrets)

  # env var name => secret ARN (injected by App Runner at runtime from Secrets Manager).
  runtime_secrets = {
    for k, env_name in local.all_secrets : env_name => aws_secretsmanager_secret.this[k].arn
  }

  # Non-secret runtime config: flags (all default false) + public JWT config + service identity.
  base_env = {
    ASPNETCORE_ENVIRONMENT                = "Production"
    Platform__ServiceName                 = var.service_name
    Platform__SupabaseJwtIssuer           = var.supabase_jwt_issuer
    Platform__SupabaseJwtAudience         = var.supabase_jwt_audience
    Platform__SupabaseJwksMetadataAddress = var.supabase_jwks_metadata_address
    Platform__ExternalVendorReadEnabled   = tostring(var.feature_flags.external_vendor_read)
    Platform__ExternalVendorWriteEnabled  = tostring(var.feature_flags.external_vendor_write)
    Platform__BillingReadEnabled          = tostring(var.feature_flags.billing_read)
    Platform__BillingUsageEnabled         = tostring(var.feature_flags.billing_usage)
    Platform__BillingWebhookWriteEnabled  = tostring(var.feature_flags.billing_webhook_write)
    Platform__BillingSelfServeEnabled     = tostring(var.feature_flags.billing_self_serve)
    Platform__ReportingReadEnabled        = tostring(var.feature_flags.reporting_read)
    Platform__ValidationStaffWriteEnabled = tostring(var.feature_flags.validation_staff_write)
    Platform__TeamIntelReadEnabled        = tostring(var.feature_flags.team_intel_read)
    Platform__Evaluation360ReadEnabled    = tostring(var.feature_flags.evaluation360_read)
    Platform__SuccessionReadEnabled       = tostring(var.feature_flags.succession_read)
    Platform__CompensationReadEnabled     = tostring(var.feature_flags.compensation_read)
    Platform__NineBoxReadEnabled          = tostring(var.feature_flags.nine_box_read)
    Platform__EngagementReadEnabled       = tostring(var.feature_flags.engagement_read)
    Platform__DeiReadEnabled              = tostring(var.feature_flags.dei_read)
    Platform__AuditLogReadEnabled         = tostring(var.feature_flags.audit_log_read)
    Platform__FxReadsEnabled              = tostring(var.feature_flags.fx_reads)
    Platform__CompensationWriteEnabled    = tostring(var.feature_flags.compensation_write)
    Platform__Evaluation360WriteEnabled   = tostring(var.feature_flags.evaluation360_write)
    Platform__SuccessionWriteEnabled      = tostring(var.feature_flags.succession_write)
    Platform__NineBoxWriteEnabled         = tostring(var.feature_flags.nine_box_write)
    Platform__EngagementWriteEnabled      = tostring(var.feature_flags.engagement_write)
    Platform__AccessReviewReadEnabled     = tostring(var.feature_flags.access_review_read)
    Platform__AccessReviewWriteEnabled    = tostring(var.feature_flags.access_review_write)
    # Q0b slice 1 (#100). NOTE: this flag shipped with the surface but was never wired here, so the
    # monitoring read surface could not be enabled in production at all — and it gates flips #64/#66/#68.
    Platform__MonitoringReadEnabled = tostring(var.feature_flags.monitoring_read)
    # Q0b slice 2 (#172): the cross-org alert-metric surface. Enabling it WITHOUT populating the
    # alert_metrics_cron secret above is inert, not open — the gate refuses everything.
    Platform__AlertMetricsCronReadEnabled = tostring(var.feature_flags.alert_metrics_cron_read)
    # #173. A STRING, not a bool: Tims.Domain.Identity.MfaGate.IsEnforced treats ONLY the exact "true" as
    # enabling, so a garbled value fails OPEN and cannot lock privileged operators out. Also never wired
    # when it shipped. Set it to the SAME value as the web app's MFA_ENFORCED — a session refused by one
    # stack and served by the other is the hole #173 closes.
    Platform__MfaEnforced = var.mfa_enforced
  }
  env = merge(local.base_env, var.otlp_endpoint == "" ? {} : { Platform__OtlpEndpoint = var.otlp_endpoint })
}

# --- ECR repository (the docker build/push in runbook §3 targets this) ----------------------------
resource "aws_ecr_repository" "api" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "IMMUTABLE" # deploy by immutable tag (the git SHA); no silent tag reuse

  image_scanning_configuration {
    scan_on_push = true # CB-7 / A.8.8 vuln scanning
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Keep only the most recent images (cost + hygiene).
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }
      action       = { type = "expire" }
    }]
  })
}

# --- Secrets Manager containers (values managed OUT-OF-BAND) ---------------------------------------
resource "aws_secretsmanager_secret" "this" {
  for_each    = local.all_secrets
  name        = "${var.service_name}/${each.value}"
  description = "TIMS Platform config secret ${each.value}. Value set out-of-band (never in TF state/code)."
}

# A placeholder version so the ARN resolves; Federico overwrites the value via CLI/console before the
# smoke gate. ignore_changes means TF NEVER reverts the real value on a later apply.
resource "aws_secretsmanager_secret_version" "placeholder" {
  for_each      = local.all_secrets
  secret_id     = aws_secretsmanager_secret.this[each.key].id
  secret_string = "REPLACE_ME_OUT_OF_BAND"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# --- IAM: ECR-access role (App Runner pulls the image) --------------------------------------------
data "aws_iam_policy_document" "apprunner_build_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apprunner_access" {
  name               = "${var.service_name}-ecr-access"
  assume_role_policy = data.aws_iam_policy_document.apprunner_build_assume.json
}

resource "aws_iam_role_policy_attachment" "apprunner_access_ecr" {
  role       = aws_iam_role.apprunner_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# --- IAM: instance role (the running task reads its secrets) --------------------------------------
data "aws_iam_policy_document" "apprunner_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${var.service_name}-instance"
  assume_role_policy = data.aws_iam_policy_document.apprunner_task_assume.json
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    sid       = "ReadPlatformSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.this : s.arn]
  }
}

resource "aws_iam_role_policy" "instance_secrets" {
  name   = "${var.service_name}-read-secrets"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

# --- Auto-scaling -----------------------------------------------------------------------------------
resource "aws_apprunner_auto_scaling_configuration_version" "this" {
  auto_scaling_configuration_name = var.service_name
  min_size                        = var.autoscaling_min_size
  max_size                        = var.autoscaling_max_size
  max_concurrency                 = var.autoscaling_max_concurrency
}

# --- The App Runner service -------------------------------------------------------------------------
resource "aws_apprunner_service" "api" {
  service_name = var.service_name

  source_configuration {
    auto_deployments_enabled = false # deploy by explicit tag change (reviewable), not on ECR push

    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access.arn
    }

    image_repository {
      image_identifier      = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
      image_repository_type = "ECR"

      image_configuration {
        port                          = "8080" # matches the Dockerfile EXPOSE / ASPNETCORE_URLS
        runtime_environment_variables = local.env
        runtime_environment_secrets   = local.runtime_secrets
      }
    }
  }

  instance_configuration {
    cpu               = var.cpu
    memory            = var.memory
    instance_role_arn = aws_iam_role.instance.arn
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/health" # liveness (no DB) — won't flap on a DB blip
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.this.arn

  # Default egress is public internet → reaches the Supabase pooler (internet-facing). No VPC
  # connector needed. Add an egress "VPC" block here only if the DB is moved VPC-private later.

  depends_on = [aws_secretsmanager_secret_version.placeholder]
}
