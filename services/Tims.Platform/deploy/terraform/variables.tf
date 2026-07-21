# Inputs for the Tims.Api App Runner deploy. Everything environment-specific is a variable so the
# same module deploys to any AWS account/region. Secret VALUES are NEVER variables (they live in
# Secrets Manager, populated out-of-band — see main.tf + README).

variable "aws_region" {
  description = "AWS region. MUST co-locate with the Supabase DB (us-west-2) — hard latency constraint (#100)."
  type        = string
  default     = "us-west-2"
}

variable "service_name" {
  description = "App Runner service name."
  type        = string
  default     = "tims-platform-api"
}

variable "ecr_repository_name" {
  description = "ECR repository the container image is pushed to (see runbook §3)."
  type        = string
  default     = "tims-platform-api"
}

variable "image_tag" {
  description = "Container image tag to deploy (e.g. the short git SHA pushed to ECR). Required."
  type        = string
}

variable "cpu" {
  description = "App Runner vCPU (e.g. \"1024\" = 1 vCPU)."
  type        = string
  default     = "1024"
}

variable "memory" {
  description = "App Runner memory in MB (e.g. \"2048\" = 2 GB)."
  type        = string
  default     = "2048"
}

variable "autoscaling_min_size" {
  description = "Minimum provisioned instances (keep >=1 so the scheduler/health stays warm)."
  type        = number
  default     = 1
}

variable "autoscaling_max_size" {
  description = "Maximum instances."
  type        = number
  default     = 3
}

variable "autoscaling_max_concurrency" {
  description = "Requests per instance before scaling out."
  type        = number
  default     = 100
}

# --- Non-secret runtime config (public values → plain env vars, not Secrets Manager) --------------

variable "supabase_jwt_issuer" {
  description = "Platform:SupabaseJwtIssuer — e.g. https://<ref>.supabase.co/auth/v1. Public. Required for auth."
  type        = string
}

variable "supabase_jwt_audience" {
  description = "Platform:SupabaseJwtAudience."
  type        = string
  default     = "authenticated"
}

variable "supabase_jwks_metadata_address" {
  description = "Platform:SupabaseJwksMetadataAddress — the JWKS URL. Public. MUST be asymmetric (RS256/JWKS), not HS256."
  type        = string
}

variable "otlp_endpoint" {
  description = "Platform:OtlpEndpoint — optional OpenTelemetry OTLP collector endpoint. Empty ⇒ unset."
  type        = string
  default     = ""
}

# --- Per-surface dark flags (default false — a deploy activates NO strangled surface) -------------
# Flip individually at cutover AFTER the FE flag is set (see the FE NEXT_PUBLIC_*_VIA_CSHARP flags).

variable "feature_flags" {
  description = "Platform:<Surface>Enabled flags. Keep all false on first deploy; flip per-surface at canary."
  type = object({
    external_vendor_read  = optional(bool, false)
    external_vendor_write = optional(bool, false)
    billing_read          = optional(bool, false)
    billing_usage         = optional(bool, false)
    billing_webhook_write = optional(bool, false)
    billing_self_serve    = optional(bool, false)
    reporting_read        = optional(bool, false)
    validation_staff_write = optional(bool, false)
    team_intel_read       = optional(bool, false)
  })
  default = {}
}

variable "manage_stripe_secrets" {
  description = "Create Secrets Manager containers + wire Stripe:SecretKey/WebhookSecret into the service. Only needed before the billing WRITE cutover."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Extra resource tags merged over the compliance defaults."
  type        = map(string)
  default     = {}
}
