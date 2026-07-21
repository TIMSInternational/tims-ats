# Terraform + provider version pins for the TIMS C# Platform (Tims.Api) AWS App Runner deploy.
# Closes the SOC 2 / ISO 27001 IaC gap (CB-4): all AWS for this service is declared here, no click-ops.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # STATE BACKEND — TODO (Federico): point at your org's remote state (S3 + DynamoDB lock, or
  # Terraform Cloud). Left local by default so `terraform init` works out-of-the-box for a first
  # `plan`, but a shared/locked backend is REQUIRED before any real `apply` (audit + concurrency).
  # backend "s3" {
  #   bucket         = "<tf-state-bucket>"
  #   key            = "tims-ats/tims-platform-api/terraform.tfstate"
  #   region         = "us-west-2"
  #   dynamodb_table = "<tf-lock-table>"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}
