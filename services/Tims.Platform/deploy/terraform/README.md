# Tims.Api — App Runner deploy (Terraform / IaC)

Infrastructure-as-Code for the first C# Platform prod deploy (Gate G3). Turns the runbook
(`docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md`) from click-ops into
`terraform plan/apply`. Reviewable, reproducible, rollback-able — and it closes the SOC 2 / ISO
27001 IaC gap (**CB-4**, A.8.9: no click-ops drift).

> **AWS owner approval and state reconciliation are required before any apply.** This module may
> not own the live App Runner service, IAM roles, ECR repository, or secrets. A fresh-state plan
> can propose duplicates and can overwrite live feature flags. Inspect and import existing
> resources, use locked remote state, and compare proposed flags with the running service first.

## What it creates

ECR repo (immutable tags, scan-on-push) · IAM ECR-access role + instance role (Secrets Manager read
only) · Secrets Manager **containers** for the sensitive config (values set out-of-band) · App Runner
auto-scaling config · the App Runner service (port 8080, `/health` liveness, env + secret refs, all
feature flags **off**). Default public egress reaches the Supabase pooler — no VPC connector.

## Decisions you must make first

1. **Which AWS account/org — RESOLVED (2026-07-27, confirmed by Federico).** `747814092517` was
   originally flagged as "the FormMaps account, TIMS ATS is not on it" — that assumption was WRONG.
   Both FormMaps and TIMS ATS are the same company's different software products and intentionally
   share this one AWS account. `747814092517` IS the correct target account for `tims-platform-api`.
   Configure AWS credentials/profile for this account before `apply` (a dedicated IAM user, e.g.
   `claude-code-agent`, already exists in it from prior FormMaps work — reusable here, or provision a
   TIMS-specific one if tighter separation is preferred).
2. **State backend.** `versions.tf` has a commented S3+DynamoDB backend — point it at your org's
   remote state before any real `apply` (local state is fine only for the first throwaway `plan`).
3. **The dual-role DB login** (the #1 deploy risk — runbook §2). The `Platform__DatabaseConnectionString`
   secret must be a login role that is BOTH a member of `app_tenant` (for the tenant path's
   `SET LOCAL ROLE`) AND can read identity tables / do privileged writes past RLS (effectively
   BYPASSRLS, for the no-TenantScope path). Provision/confirm it, then put its connection string in
   the secret (below). `/whoami` in the smoke gate proves it.

## Deploy flow

```bash
# 0) Pre-reqs (runbook §0): rotate the leaked prod DB password + update Vercel env first.

# 1) Build + push the image (runbook §3) — Terraform references it by tag, it does NOT build it.
#    (Create the ECR repo via `terraform apply -target=aws_ecr_repository.api` first if you want the
#     repo to exist before the push, then push, then full apply with that image_tag.)

# 2) Configure + plan.
cp terraform.tfvars.example terraform.tfvars   # fill in image_tag + supabase_* ; flags stay false
terraform init
terraform validate
terraform plan

# 3) Apply.
terraform apply

# 4) Populate the secret VALUES out-of-band (they are NOT in TF). Use the secret_arns output:
terraform output secret_arns
aws secretsmanager put-secret-value --secret-id <db-arn>            --secret-string '<dual-role conn string>'
aws secretsmanager put-secret-value --secret-id <redis-arn>         --secret-string '<upstash url>'
aws secretsmanager put-secret-value --secret-id <impersonation-arn> --secret-string '<= the TS impersonation secret>'
#    #172 — ONLY needed before enabling alert_metrics_cron_read. Generate, do not invent:
aws secretsmanager put-secret-value --secret-id <alert_metrics_cron-arn> --secret-string "$(openssl rand -base64 48)"
#    ...then set the SAME value as ALERT_METRICS_CRON_SECRET in Vercel. It must be >= 32 chars and must
#    not be the REPLACE_ME_OUT_OF_BAND placeholder — CronCallerGate rejects both as unconfigured, so the
#    surface stays 401 rather than trusting a credential that is committed to this repo.
#    App Runner picks up the latest secret version on its next deployment/restart.

# 5) Smoke gate (runbook §5, still dark): /health 200, /ready 200, /openapi 200, a staff-JWT /whoami
#    200 (proves the DB role + JWKS), every strangler route 404. Do NOT cut over until /ready+/whoami green.
```

## Cutover (per surface, later)

Flip the backend flag in `feature_flags` (→ `terraform apply`) AND set the matching FE flag
(`NEXT_PUBLIC_<SURFACE>_VIA_CSHARP=true` + `NEXT_PUBLIC_TIMS_PLATFORM_API_URL=<service_url output>`)
→ canary → verify → delete the TS surface. Rollback = flag back to false + unset the FE flag.

## Notes

- **Secrets are never in TF state or code** — only empty containers + an ignored placeholder version.
  Real values are written with `put-secret-value` and TF won't revert them (`ignore_changes`).
- **Workers/HRIS deferred** — this module is the `Tims.Api` service only. Add a sibling for
  `Tims.Workers` (+ the `hris_domain` EF migration + the clustered-Quartz connection) when HRIS goes
  live (runbook §8).
- Reconcile with your existing AWS conventions (tagging, VPC, state) — this was written standalone.

## Proctoring evidence and inference foundation

The proctoring extension is declared in `proctoring-*.tf` and follows
`docs/architecture/2026-09-24-proctoring-ai-target.md`. Its master switch,
`proctoring_infrastructure_enabled`, is **false** by default, so it creates no S3,
KMS, SQS, ECR, Lambda, budget, or alarm resources. The three application flags
`proctoring`, `proctoring_media_evidence`, and `proctoring_cloud_inference` are
independently false. An enabled media flag requires the local proctoring flag and
infrastructure; cloud inference also requires media, a digest-pinned worker image,
and a model revision. This Terraform is a deployable definition, not a running
worker. The local .NET evidence flow still needs staging verification.

To prepare a **reviewable plan** after importing the existing live App Runner
resources, set the following non-secret variables in a private `terraform.tfvars`:

```hcl
proctoring_infrastructure_enabled = true
proctoring_evidence_bucket_name   = "tims-ats-proctoring-evidence-<account>-us-west-2"
proctoring_upload_origins         = ["https://tims-ats.vercel.app"]
proctoring_budget_email           = "ops@example.com"
# proctoring_alarm_topic_arn      = "arn:aws:sns:us-west-2:<account>:tims-alerts"
```

This first infrastructure step creates a private **S3 Standard** bucket with
public-access block, ownership enforcement, TLS-only policy, SSE-KMS and S3 Bucket
Keys; a customer-managed KMS key; staging expiry after one day, sealed-media
expiry after seven days, and noncurrent-version cleanup; scoped browser CORS;
encrypted Standard request/result queues and DLQs; bounded policies on the
existing App Runner instance role and a separate Lambda role; a worker ECR
repository; and a monthly USD budget plus queue/DLQ alarms. The S3 bucket has
`prevent_destroy` and `force_destroy = false`; it cannot be accidentally removed
by setting the switch back to false. The region must be `us-west-2` for this first
design. Browser uploads need a .NET-signed, short-lived POST policy for an exact
**staging** key, MIME type, and `content-length-range`; CORS alone does not grant
write access. Sign both `x-amz-server-side-encryption=aws:kms` and the exact
`x-amz-server-side-encryption-aws-kms-key-id` from
`Platform__ProctoringEvidenceKmsKeyArn`. The API must inspect and conditionally
copy a validated upload to a sealed key, then dispatch only the sealed reference.
Reviewer reads require
short-lived, audited signed GETs. No browser AWS credentials are issued.
Set the Vercel web app's `NEXT_PUBLIC_PROCTORING_EVIDENCE_S3_ORIGIN` to the
`proctoring_evidence_s3_origin` output. The upload helper and CSP use this exact
HTTPS origin; verify it matches the .NET SDK's signed POST URL in staging before
turning on media evidence. The bucket origin is not a credential.

The S3 lifecycle is an **asynchronous backstop**, not an exact seven-day deletion
clock. The .NET API denies reads at the seven-day deadline; its retention job
sweeps every five minutes under a database advisory lock and retries failed
S3 deletion. Monitor physical deletion lag separately. Versioning is not enabled. The API must also
enforce the capture policy (one camera and one screen still per minute, at most
five extras of each per 30-minute exam), maximum bytes/dimensions, tenant and
session rate limits, consent, and human-only decisions. None of those controls
are supplied by Terraform.

The Lambda is absent until `proctoring_worker_image_uri` names an immutable
ECR `@sha256:` digest and `proctoring_model_revision` names the evaluated model
bundled inside it. The image must be built, scanned, licensed, and tested
separately; there is no runtime Hugging Face download. Its SQS event source
remains active while the pinned worker exists, including when
`proctoring_cloud_inference` is turned off to stop new admission. This lets
already-confirmed work drain. Keep the worker image and queues provisioned until
the request queue, result queue, and API outbox are empty before removal. The worker
has at most two reserved concurrent executions, 90-second timeout, and no VPC,
NAT gateway, database credentials, or always-on GPU. It can read sealed evidence,
call Rekognition `DetectFaces`, and send bounded results; it cannot mutate reviews.
The local .NET result consumer must pass AWS queue replay and idempotency tests
before that flag is enabled. `proctoring_hf_detector_enabled` stays false by default, so the worker
reports the Hugging Face detector as unavailable. Turn it on only with cloud
inference enabled **and** a digest-pinned `services/proctoring-inference/Dockerfile.hf`
image containing the approved, checksum-verified model artifact. Terraform can
check the flag and image URI, but cannot prove which Dockerfile built that digest;
the release gate must verify the image provenance and TIMS-specific model evaluation.
These resources provide no validated AI accuracy or identity proof.

The monthly budget is an **alert, not a spending shutoff**. Activate the
`Component` cost allocation tag in AWS Billing before relying on its resource-tag
filter; untaggable Rekognition usage may not be included. The Lambda invocation
alarm is also a soft signal, and CloudWatch alarms have no delivery destination
unless `proctoring_alarm_topic_arn` is set to an existing subscribed SNS topic.
Hard costs are bounded primarily by the API's image caps and the Lambda concurrency
limit, which must be verified before a client pilot. Run the Oregon pricing
calculator with measured image sizes and monthly exams. Outputs provide the
bucket/KMS identity, request/result queue URLs, worker role, ECR URL, and optional
Lambda ARN for the .NET and worker deployment contracts.
