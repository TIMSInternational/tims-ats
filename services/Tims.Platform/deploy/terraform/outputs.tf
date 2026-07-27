output "service_url" {
  description = "The App Runner service URL (this is NEXT_PUBLIC_TIMS_PLATFORM_API_URL for the FE cutover)."
  value       = "https://${aws_apprunner_service.api.service_url}"
}

output "service_arn" {
  description = "App Runner service ARN."
  value       = aws_apprunner_service.api.arn
}

output "ecr_repository_url" {
  description = "ECR repo URL to build/push the image to (runbook §3)."
  value       = aws_ecr_repository.api.repository_url
}

output "secret_arns" {
  description = "Secrets Manager ARNs to populate out-of-band (env var name => ARN). Set the DB one to the dual-role connection string; see README."
  value       = { for env_name, arn in local.runtime_secrets : env_name => arn }
}

output "active_feature_flags" {
  description = "Names of feature_flags currently set to true (i.e. which Platform:*Enabled surfaces THIS apply would turn on). Empty on a first/dark deploy. Diff this against known prod reality (e.g. team_intel_read, confirmed live out-of-band as of 2026-07-27 — see main.tf's top-of-file NOTICE) before every apply to catch drift between this module's state and what's actually flipped in the real service."
  value       = sort([for k, v in var.feature_flags : k if v])
}
