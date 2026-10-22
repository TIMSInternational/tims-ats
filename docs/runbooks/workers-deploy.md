# Runbook — deploying Tims.Workers (Quartz scheduler host) to production

> **Owner-run.** The PR that added this file changed no AWS resource. It added the image health probe,
> the deploy workflow (inert until enabled), the IAM grants (applied only when you re-run the bootstrap),
> and `scripts/deploy/create-workers-service.sh` (dry-run by default). Account `747814092517`,
> region **us-west-2**, profile `tims-ats`.

## What it is

`services/Tims.Platform/src/Tims.Workers` — an ASP.NET host running Quartz:

| Job            | Default schedule                | Switch                                                               | What it writes                                                                                                                 |
| -------------- | ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FxRefreshJob` | `0 0 5 * * ?` (05:00 UTC daily) | `Workers__FxRefreshEnabled` (default true)                           | `fx_rates` via idempotent `INSERT … ON CONFLICT (base_currency, quote_currency, as_of) DO UPDATE` on the privileged connection |
| `HrisSyncJob`  | `0 0 * * * ?` (hourly)          | `Workers__HrisSyncEnabled` (default true — **set false**, see below) | per-org `hris_*` rows under TenantScope                                                                                        |

It has never been deployed. Today the FX refresh runs **inside the API** instead
(`FxRefreshHostedService`, `Platform__FxRefreshEnabled=true` on the live App Runner service — read
2026-10-01): one run at API boot, then every 24 h.

## Why ECS Fargate, not App Runner

The workers serve no traffic; the HTTP listener exists only for `/health` and `/ready`.

1. **App Runner throttles CPU outside request handling.** A 05:00 UTC Quartz fire has no request around it.
2. **App Runner rolls out side-by-side.** During every deploy the old and new instance both run — two
   in-memory (`RAMJobStore`) schedulers. Clustering (`Workers__ClusteredSchedulerEnabled`) would fix that but
   needs the `qrtz_*` DDL in prod, which has not been applied.
3. ECS service with `desiredCount=1`, `minimumHealthyPercent=0`, `maximumPercent=100` **stops the old task
   before starting the new one**, so a trigger can never fire from two replicas. Deployment circuit breaker
   with rollback is on.

Shape: one Fargate task, 0.25 vCPU / 0.5 GB (`WORKERS_CPU`/`WORKERS_MEMORY` to change), default VPC public
subnets with a public IP and an **egress-only** security group (no inbound rule, no NAT gateway). Roughly
$9–10/month. Logs: CloudWatch `/ecs/tims-platform-workers`, 30-day retention.

## Double-execution analysis (API hosted service + workers)

| Overlap                                                             | Consequence                                                                                                                                                                                                     | Verdict                                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API `FxRefreshHostedService` **and** workers `FxRefreshJob` both on | Two provider calls per day; both upsert the same `(base, quote, as_of)` rows — last writer wins with the same rate; `fetched_at` moves. No duplicate rows.                                                      | **Safe.** Intended for the cut-over window.                                                                       |
| Two workers tasks during a deploy                                   | Prevented: ECS min 0 % / max 100 % never runs two. `[DisallowConcurrentExecution]` additionally stops overlapping fires _within_ one scheduler.                                                                 | Safe by construction.                                                                                             |
| `HrisSyncJob` with connectors whose secret is not configured        | `EnvConnectorSecretStore` needs `HRIS_SECRET_<REF>` env vars per connector (the AWS Secrets Manager store is still a stub). The sweep would fail every hour for each such connector (logged, alerted log-only). | **Start with `Workers__HrisSyncEnabled=false`** (the script's default). Enable only once connector secrets exist. |
| Clustered scheduler                                                 | Not enabled (`Workers__ClusteredSchedulerEnabled=false`), no `qrtz_*` tables needed.                                                                                                                            | n/a until Phase 4 slice 2 DDL is applied.                                                                         |

## Configuration the task gets

Set by `create-workers-service.sh` in the task definition (non-secret):

| Env var                              | Value                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `ASPNETCORE_ENVIRONMENT`             | `Production`                                                                      |
| `Platform__ServiceName`              | `tims-platform-workers`                                                           |
| `Workers__FxRefreshEnabled`          | `true` (`--fx-refresh false` to register a revision without it)                   |
| `Workers__HrisSyncEnabled`           | `false` (`--hris-sync true` later)                                                |
| `Workers__ClusteredSchedulerEnabled` | `false`                                                                           |
| `Email__Enabled`                     | `false` (the workers send no mail; `AddPlatformEmail` is registered but disabled) |

Secret (injected by ECS, never read by the script):

| Env var                              | Secrets Manager secret                                                                                                                                                | Shared with                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Platform__DatabaseConnectionString` | `tims-platform-api/DatabaseConnectionString` (live name; `terraform/main.tf` would call it `…/Platform__DatabaseConnectionString`, but that module was never applied) | the API — the same dual-role login: privileged for `fx_rates`, `app_tenant` member for HRIS TenantScope |

Not needed: Redis, impersonation secret, Supabase keys, Stripe, invitation keys. Optional later:
`Platform__OtlpEndpoint` (OTel export), `Fx__*` resilience knobs, `Workers__FxRefreshCron`, `HRIS_SECRET_*`.

IAM: the **execution role** `tims-platform-workers-execution` may pull only the workers ECR repo, write
only its log group, and read only that one secret. The **task role** `tims-platform-workers-task` has no
policy (the jobs call no AWS API). The GitHub deploy role gains: push to the workers ECR repo,
`ecs:RegisterTaskDefinition`/`DescribeTaskDefinition` (not resource-scopable), `ecs:DescribeServices`/
`UpdateService` on the one service, and `iam:PassRole` for the two workers roles to `ecs-tasks.amazonaws.com`.

## Health checks

| Probe                      | Where                                                                                              | Meaning                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/health`                  | listener `:8080`, liveness, **no DB**                                                              | process + pipeline up                                                                                                                                                                |
| `/ready`                   | listener `:8080`, pings Postgres                                                                   | DB reachable (503 otherwise)                                                                                                                                                         |
| ECS container health check | `dotnet Tims.Workers.dll --healthcheck` (interval 30 s, timeout 5 s, 3 retries, 60 s start period) | the binary probes its own loopback `/health` and exits 0/1 — the `aspnet` image has no curl/wget. Loopback only; any other target is refused. Also the image's Docker `HEALTHCHECK`. |

An unhealthy task is replaced by ECS. A DB outage does **not** fail liveness (by design — Quartz retries).

### Fail-closed startup (added with the cherry-pick onto main, 2026-10-12)

- **Unusable DB connection string ⇒ the process exits 1 at boot.** `DatabaseConnectionStringGuard`
  (`src/Tims.Workers/DatabaseConnectionStringGuard.cs`, wired in `Program.cs` via `ValidateOnStart`) rejects an
  empty value, the Terraform placeholder `REPLACE_ME_OUT_OF_BAND`, an unparseable string, and — outside
  Development/Testing — a loopback host. The last case matters: `appsettings.json` ships
  `Host=localhost`, so a task whose secret injection is missing would otherwise boot "healthy" (lazy DbContexts,
  DB-free `/health`) and fail every FX/HRIS fire forever. The value is never logged.
- **Startup failures RETURN 1 instead of rethrowing.** Reproduced locally: with `dotnet` as PID 1 (no init),
  a rethrown startup exception went through `abort()`, the kernel ignored the SIGABRT for PID 1, and the
  container stayed `running` (spinning) instead of exiting — so the fail-closed check never stopped the task.
  The task definition additionally sets `linuxParameters.initProcessEnabled=true` (tini as PID 1) so any other
  crash also terminates the task and ECS restarts it / the circuit breaker rolls back.
- **Liveness does not watch the scheduler.** If Quartz stopped while Kestrel kept serving, `/health` would stay 200. The proof of life is the daily `fx refresh` log line and `max(fetched_at)` in `fx_rates` (§Verify).

## Procedure

Run each block from the repo root on `main` after this PR merges. Wait for each to succeed before the next.

**1. Foundation (ECR repo, log group, roles, cluster, security group).** Dry run first, read the plan, then apply.

```bash
bash scripts/deploy/create-workers-service.sh
bash scripts/deploy/create-workers-service.sh --apply
```

**2. Grant the GitHub deploy role the workers permissions** (idempotent; re-verifies the role's exact scope).

```bash
bash scripts/deploy/bootstrap-github-oidc-role.sh
```

**3. Enable the workflow and push the first image.**

A manual dispatch deploys **main's tip** and refuses unless `.NET Platform CI` has a successful
**push-triggered** run on that exact commit. That CI's push trigger is path-filtered, so if the last merge
to `main` was web-only or docs-only the tip was never tested and the dispatch fails with
".NET Platform CI has no successful push run". Check first — this prints a number:

```bash
gh api "repos/TIMSInternational/tims-ats/actions/workflows/dotnet-platform.yml/runs?head_sha=$(gh api repos/TIMSInternational/tims-ats/commits/main --jq .sha)&event=push&status=success&per_page=1" --jq .total_count
```

`1` (or more): go ahead. `0`: either .NET CI is still running on the tip (wait for it to finish green and
re-check) or it never ran there. In the second case land any commit on `main` that touches a path in
`.NET Platform CI`'s push filter (`services/Tims.Platform/**`, `scripts/**`, `packages/db/**`, ... — see
`.github/workflows/dotnet-platform.yml`), wait for that CI run to pass, re-check, then dispatch.
`.NET Platform CI` has no `workflow_dispatch` trigger, and a non-push run would not count anyway. While the
service does not exist yet, the automatic post-CI run pushes **nothing** (only a manual dispatch seeds the
first image), so the dispatch below is always needed for the first image.

```bash
gh variable set PLATFORM_WORKERS_DEPLOY_ENABLED --body true --repo TIMSInternational/tims-ats
gh workflow run 'Deploy platform workers' --ref main -f reason='first workers image' --repo TIMSInternational/tims-ats
```

The run summary prints the pushed tag (the 7-char short SHA) and "no ECS service yet".

**4. Create the service on that tag.** Replace `abc1234` with the tag from step 3.

```bash
bash scripts/deploy/create-workers-service.sh --image-tag abc1234
bash scripts/deploy/create-workers-service.sh --apply --image-tag abc1234
```

From now on every merge that passes `.NET Platform CI` and changes the workers project graph rolls the
service automatically (image swap only; env/secrets carried over from the live revision).

**Image retention.** ECR keeps the last 30 images **plus every image that was ever deployed**. The workflow
decides **before** building (`scripts/deploy/workers-deploy-decide.sh`) and pushes only an image it is about
to roll onto (or, with no service yet, the manually-dispatched seed), so idle CI runs do not churn the repo.
That ordering alone does NOT keep the running image: ECR counts by **push** time, a failed roll leaves a
newer image behind, and a rollback restores an older image without refreshing its push time. So both deploy
paths (the workflow and `create-workers-service.sh --apply --image-tag`) run
`scripts/deploy/workers-protect-image.sh` **before** pointing the service at an image: it adds the immutable
tag `deployed-<tag>`. The lifecycle policy's priority-1 rule selects that prefix, and ECR never lets the
lower-priority 30-image rule expire an image a higher-priority rule selected. The workflow also protects the
image it rolls away from (the rollback target). Deployed images are kept for 3650 days; delete one by hand
only if it is neither running nor a rollback target.

## Verify

1. `aws ecs describe-services --profile tims-ats --region us-west-2 --cluster tims-platform --services tims-platform-workers --query 'services[0].[status,runningCount,desiredCount]'` → `ACTIVE 1 1`.
2. Logs show the host started and no `Fatal` line:
   `aws logs tail /ecs/tims-platform-workers --profile tims-ats --region us-west-2 --since 15m`
3. After the next 05:00 UTC: a `fx refresh: pinned N rate(s)` line with N > 0, and
   `SELECT max(as_of), max(fetched_at) FROM fx_rates;` shows today. (Unlike the API's hosted service, the
   Quartz job does **not** run at boot — the first proof is the first 05:00 UTC fire after creation.)

## Turning the API's FX hosted service off (after workers are proven)

Keep both running for **at least two successful 05:00 UTC workers runs** (overlap is safe — see above). Then:

1. App Runner console → `tims-platform-api` → Configuration → Edit → Environment variables:
   set `Platform__FxRefreshEnabled` to `false` (edit the value in place — do **not** script
   `update-service` with a partial map; it drops every omitted key, see `enable-fx-refresh.sh`).
2. Deploy the configuration change, then confirm the API logs no longer show `fx refresh (api host)` lines
   and the workers' next run still pins rates.

Re-enabling it is the instant fallback if the workers ever stop (`enable-fx-refresh.sh`).

## Rollback / kill switch

| Situation                   | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad workers image           | `bash scripts/deploy/create-workers-service.sh --apply --image-tag <previous tag>` (the previous tag is in the last workflow summary). ECS's circuit breaker also auto-rolls back a deploy whose task never becomes healthy; the workflow then FAILS red (`scripts/deploy/workers-verify-roll.sh`: the PRIMARY deployment is not the new revision), it never reports a rolled-back deploy as rolled. The verifier polls the deployment's `rolloutState` after `services-stable` (which does not wait for it): `IN_PROGRESS` keeps waiting, `COMPLETED` passes, `FAILED` fails and prints `rolloutStateReason`, and after 15 minutes (`VERIFY_ROLL_TIMEOUT_SECONDS`) it fails loud. The manual path (`create-workers-service.sh --apply --image-tag`) runs the same verifier after its waiter and exits non-zero instead of printing success after a rollback; it needs `jq`. |
| Stop the scheduler entirely | `bash scripts/deploy/create-workers-service.sh --apply --stop` (desired count 0; nothing deleted). If the API's FX flag was turned off, turn it back on (`bash scripts/deploy/enable-fx-refresh.sh`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Stop automatic rollouts     | `gh variable set PLATFORM_WORKERS_DEPLOY_ENABLED --body false --repo TIMSInternational/tims-ats`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Disable just FX or HRIS     | re-run step 4 with `--fx-refresh false` or `--hris-sync false` and the current tag (registers a new revision with that env).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
