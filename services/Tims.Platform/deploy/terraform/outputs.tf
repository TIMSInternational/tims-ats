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

output "proctoring_evidence_bucket_name" {
  description = "Private S3 Standard evidence bucket; null while proctoring infrastructure is disabled."
  value       = try(aws_s3_bucket.proctoring_evidence[0].bucket, null)
}

output "proctoring_evidence_s3_origin" {
  description = "Exact HTTPS S3 origin for NEXT_PUBLIC_PROCTORING_EVIDENCE_S3_ORIGIN in the web app CSP and upload helper; null while disabled. Verify against a real signed POST URL before activation."
  value       = try("https://${aws_s3_bucket.proctoring_evidence[0].bucket_regional_domain_name}", null)
}

output "proctoring_evidence_kms_key_arn" {
  description = "Customer-managed S3 evidence key ARN; null while disabled."
  value       = try(aws_kms_key.proctoring_evidence[0].arn, null)
}

output "proctoring_inference_request_queue_url" {
  description = "Request SQS URL for .NET to enqueue sealed evidence references; null while disabled."
  value       = try(aws_sqs_queue.proctoring_request[0].url, null)
}

output "proctoring_inference_result_queue_url" {
  description = "Result SQS URL for the .NET consumer; null while disabled."
  value       = try(aws_sqs_queue.proctoring_result[0].url, null)
}

output "proctoring_inference_worker_role_arn" {
  description = "Least-privilege Lambda worker IAM role ARN; null while disabled."
  value       = try(aws_iam_role.proctoring_worker[0].arn, null)
}

output "proctoring_inference_worker_repository_url" {
  description = "ECR repo for the separately built, pinned inference image; null while disabled."
  value       = try(aws_ecr_repository.proctoring_worker[0].repository_url, null)
}

output "proctoring_inference_worker_function_arn" {
  description = "Lambda ARN once an immutable worker image and evaluated model are configured; null otherwise."
  value       = try(aws_lambda_function.proctoring_worker[0].arn, null)
}
