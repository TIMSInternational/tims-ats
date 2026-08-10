# Tims.Api — App Runner deploy (Terraform / IaC)

Infrastructure-as-Code for the first C# Platform prod deploy (Gate G3). Turns the runbook
(`docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md`) from click-ops into
`terraform plan/apply`. Reviewable, reproducible, rollback-able — and it closes the SOC 2 / ISO
27001 IaC gap (**CB-4**, A.8.9: no click-ops drift).

> **Run by Federico** (owns AWS/prod). Terraform is not installed in the dev sandbox, so this was
> authored but NOT `validate`/`plan`-checked locally — your first step is `terraform init && validate && plan`.

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
