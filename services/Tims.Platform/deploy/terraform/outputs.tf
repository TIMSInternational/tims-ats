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
