# All proctoring infrastructure is opt-in. Terraform has not been reconciled with
# the live App Runner service; setting this true is not permission to apply.
variable "proctoring_infrastructure_enabled" {
  description = "Create private proctoring evidence, SQS, IAM, alarms and worker ECR resources. Default false."
  type        = bool
  default     = false
}

variable "proctoring_evidence_bucket_name" {
  description = "Globally unique, existing-state-reconciled S3 bucket name. Required when the foundation is enabled."
  type        = string
  default     = ""
}

variable "proctoring_upload_origins" {
  description = "Exact HTTPS browser origins allowed to POST evidence and GET short-lived reviewer URLs. No wildcard."
  type        = list(string)
  default     = []
  validation {
    condition = alltrue([
      for origin in var.proctoring_upload_origins :
      can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$", origin)) && !strcontains(origin, "*")
    ])
    error_message = "Every proctoring upload origin must be an exact HTTPS origin without a wildcard or path."
  }
}

variable "proctoring_worker_image_uri" {
  description = "Immutable ECR image digest for the separately built inference worker. Empty keeps Lambda absent."
  type        = string
  default     = ""
  validation {
    condition     = var.proctoring_worker_image_uri == "" || can(regex("@sha256:[0-9a-f]{64}$", var.proctoring_worker_image_uri))
    error_message = "The worker image must be an immutable ECR URI ending in @sha256:<64 lowercase hex chars>."
  }
}

variable "proctoring_model_revision" {
  description = "Bounded model/contract revision shared by .NET and Lambda; the default is an evaluation placeholder, not production validation."
  type        = string
  default     = "camera-v1-eval"
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,64}$", var.proctoring_model_revision))
    error_message = "The proctoring model revision must be 1-64 ASCII letters, digits, periods, underscores, or hyphens."
  }
}

variable "proctoring_hf_detector_enabled" {
  description = "Enable the evaluated Hugging Face person/phone detector in the pinned Dockerfile.hf worker image. Default false."
  type        = bool
  default     = false
}

variable "proctoring_budget_email" {
  description = "Budget alert recipient. Required before creating the evidence foundation."
  type        = string
  default     = ""
}

variable "proctoring_monthly_budget_usd" {
  description = "Monthly proctoring resource-tag budget alert (USD); an alert, not an AWS spending shutoff."
  type        = number
  default     = 50
  validation {
    condition     = var.proctoring_monthly_budget_usd >= 1 && var.proctoring_monthly_budget_usd <= 10000
    error_message = "The monthly budget must be between USD 1 and USD 10,000."
  }
}

variable "proctoring_alarm_topic_arn" {
  description = "Existing SNS alert topic ARN. Empty creates CloudWatch alarms without action delivery."
  type        = string
  default     = ""
}

variable "proctoring_daily_worker_invocation_alarm" {
  description = "Soft CloudWatch alert threshold for worker invocations in one day; hard image caps belong in .NET."
  type        = number
  default     = 5000
  validation {
    condition     = var.proctoring_daily_worker_invocation_alarm >= 100
    error_message = "The daily worker invocation alarm threshold must be at least 100."
  }
}
