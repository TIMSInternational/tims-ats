# Phase 4 Slice 1 — Worker host + Quartz scheduler + resilient-job framework + first recurring job

Date: 2026-07-16 · Status: **In build (SDD).** Parent: `phase-4-workers.md` / `00-master-plan.md`.
Branch: `feat/csharp-phase4-workers` off main `9371f60`. Deploy-gated (no prod deploy this slice).

## Objective (what this slice delivers toward Gate G4)

Turn `Tims.Workers` from a library into a **deployable, single-replica scheduler host** that runs the
existing `HrisSyncJob` on a cadence, wrapped in **reusable idempotency / retry / failure-visibility
infrastructure** that Phase 3 (HRIS) and every Phase 5 domain job will consume. Everything is
**buildable + testable with fakes ahead of the Federico-gated AWS deploy**; the only thing this slice does
NOT do is flip it live (that lands with WP3.4/G3).

G4 wants "≥1 recurring job, idempotent, retried, failures visible, tenant isolation holds inside jobs." This
slice builds all of that structurally; "live in prod" is the deploy step, deferred.

## The load-bearing decision — WP4.1 scheduler choice (VETOABLE by Federico)

**Chosen: Quartz.NET 3.18.2 in-process, hosted in a dedicated single-replica worker host.** Not Hangfire,
not EventBridge+SQS. Rationale (architecturally correct for the actual data usage, per the standing directive):

- **Quartz is a pure scheduler that triggers *our* `IJob`s.** We keep total control of the per-fire DI scope
  and the per-job tenant handling — critical, because `HrisSyncJob` reads connectors on the **privileged
  owner** connection and then writes **per-org under `TenantScope`** (RLS). A scheduler must not impose its
  own data-access model on that.
- **Hangfire rejected:** it manages its own storage schema and wants broad DB privileges that fight the
  `app_tenant`/RLS model; its tables would need ledger + RLS-exemption treatment. Not worth it for a handful
  of code-defined recurring jobs.
- **EventBridge+SQS+Fargate-consumer rejected (for now):** over-engineering for an hourly HRIS sweep + a
  daily audit purge. The master plan says "start in-process; go cloud-native only if scale/isolation demands
  it." **Reversible** — jobs are plain classes; swapping the trigger source later touches only the host.
- **Topology:** the scheduler runs in its **own host, deployed at replica = 1** (the API scales
  horizontally for request load; the scheduler must fire a recurring job **exactly once**, not once per API
  replica). Multi-replica scheduler HA (Quartz clustering + a persistent ADO job store) is a **documented
  follow-up**, only needed if the scheduler itself needs failover; a missed hourly window self-heals on the
  next tick (Quartz misfire handling covers restart), so single-replica is correct day-one, not "safe/minimal".

## Structure outline (files; C-header style)

```
src/Tims.Workers/                              (Sdk.Web executable host; was Sdk library)
  Tims.Workers.csproj        → OutputType Exe, Sdk.Web; + Quartz, Quartz.Extensions.Hosting,
                               Serilog.AspNetCore, OTel(.AspNetCore/.Npgsql/.Quartz? via source), lockfile
  Program.cs                 → host bootstrap: Serilog RenderedCompactJson, config bind+validate
                               (PlatformOptions + HrisOptions, ValidateOnStart), OTel (ActivitySource
                               "Tims.Workers" + Quartz + Npgsql), Quartz hosted service, HRIS DI plane,
                               /health liveness (200, no deps) + /ready (DB ping), map schedule
  WorkerOptions.cs           → bound "Workers" section: HrisSyncCron (default hourly), Enabled toggles,
                               retry knobs (MaxAttempts, BaseDelayMs) — DataAnnotations, flat
  Scheduling/
    QuartzScheduleBuilder.cs → registers jobs+triggers from WorkerOptions (identity, cron, misfire policy)
  Jobs/
    ResilientJobRunner.cs    → the reusable wrapper: OTel span per run + structured start/ok/fail logs
                               (job name, fire id, duration; NO PII) + bounded Polly retry w/ backoff on
                               transient + failure counter + IJobFailureAlerter hook; NEVER throws out of
                               Execute (a job fault must not destabilise the scheduler)
    IJobFailureAlerter.cs    → port; LogOnlyJobFailureAlerter default (real channel wired at deploy)
    JobMetrics.cs            → OTel Meter "Tims.Workers": runs/successes/failures/duration counters
  Hris/
    HrisSyncQuartzJob.cs     → IJob; creates an IServiceScope per fire, resolves HrisSyncJob (scoped
                               repos + HrisDbContext), invokes RunAsync under ResilientJobRunner
    HrisWorkerServiceCollectionExtensions.cs  → (exists) unchanged; host also wires HrisDbContext,
                               AddHrisConnectors, audit context/writer, EnvConnectorSecretStore
  Dockerfile                 → mirror Api Dockerfile; ENTRYPOINT dotnet Tims.Workers.dll; EXPOSE 8080
tests/Tims.UnitTests/Workers/
  ResilientJobRunnerTests.cs → retry-then-succeed; give-up-after-N (+alerter fired, failure counted);
                               success path; NEVER-throws-out contract; cancellation propagates (not swallowed)
  WorkerOptionsTests.cs      → cron/knob validation bounds
tests/Tims.IntegrationTests/Workers/
  WorkerHostSmokeTests.cs    → boot the host (WebApplicationFactory<Program>); /health 200; Quartz scheduler
                               started; HRIS job+trigger registered on the configured cron
  HrisScheduledFireTests.cs  → TriggerJob the HRIS quartz job with FAKE ports in DI → sweep runs end-to-end
                               through a real per-fire scope; REGRESSION: one connector throwing still
                               processes the rest and does NOT crash the scheduler (preserves Codex Low#2)
```

## Key mechanics / invariants (must hold)

1. **DI-scope-per-fire.** Quartz jobs are resolved from the container as needed, but `HrisSyncJob` +
   repositories + `HrisDbContext` are **scoped**. `HrisSyncQuartzJob.Execute` MUST create an
   `IServiceScope` and resolve from it, disposing at end — never resolve scoped services from the root
   provider (captive-dependency / cross-fire DbContext reuse bug). Use the Quartz
   `MicrosoftDependencyInjectionJobFactory` (from `Quartz.Extensions.Hosting`) which already scopes the JOB;
   the sweep's scoped deps are resolved inside that job's scope.
2. **Tenant isolation inside the job is unchanged.** The worker registers the **privileged** owner read
   (`HrisConnectorReadRepository`) + the tenant-scoped write plane exactly as `Tims.Api` does; the sweep
   already sets the org GUC per connector via the repositories' `TenantScope`. The scheduler adds NO new
   tenant surface — it just invokes the existing, already-tenant-correct use case. (Deploy-verify: the
   privileged read needs the BYPASSRLS pooler role — same as Api — else 0 rows / silent no-op.)
3. **Resilience is run-level + idempotent.** `HrisSyncJob` is already internally idempotent (hourly bucket
   key + terminal short-circuit) and per-connector-isolated. `ResilientJobRunner` adds a **bounded** Polly
   retry (transient only) around the whole fire, then gives up → logs Error + fires the alerter + increments
   the failure counter, and **returns** (does not rethrow) so Quartz is never destabilised; the next cron
   tick is the natural retry for a recurring job. Because the job is idempotent, a retry can never double-write.
4. **`OperationCanceledException` is NEVER swallowed as a failure.** Host shutdown / trigger cancellation
   must propagate cooperatively (mirror the existing sweep's `catch (OperationCanceledException) { throw; }`).
5. **Failures are visible.** Every run emits an OTel span (`ActivitySource "Tims.Workers"`) + a structured
   Serilog line (RenderedCompactJson, no PII), and success/failure/duration land on an OTel `Meter`. A
   persistent failure fires `IJobFailureAlerter` (log-only default; real channel = deploy config).
6. **No secrets logged/serialized.** Reuse `ConnectorSecret` (never-logged, already proven); the worker only
   ever handles a `secret_ref`, resolved by `EnvConnectorSecretStore` (dev) / AWS Secrets Manager (prod).
7. **Health for the orchestrator.** `/health` = liveness (process up, no deps → App Runner/Fargate health
   check). `/ready` = a cheap DB ping (the scheduler needs the DB). Liveness must not depend on the DB.

## Regression-corpus gate (STANDING directive)

Ported/affected surface = the HRIS background sweep. The one hard-won fix on it is **Codex Low#2 —
per-connector isolation** (one connector's failure must not abort the sweep), pinned today by
`HrisSyncJobTests`. This slice wraps the sweep in a scheduler, so the must-bite test is:
`HrisScheduledFireTests` — a **scheduled fire** where one connector throws still processes the rest **and
does not crash the scheduler**. Prove it bites (make the runner rethrow → red). Also assert cancellation is
not reclassified as a job failure (host-shutdown correctness).

## Local gate (before PR)

From `services/Tims.Platform`: `dotnet build Tims.Platform.slnx -c Release` (0 warn) · `dotnet format
--verify-no-changes` · `dotnet test tests/Tims.UnitTests/...` · `dotnet test tests/Tims.IntegrationTests/...`
(Docker up). From root: `node scripts/table-ownership.mjs` (no TS/table change expected — worker owns no new
tables). No `apps/web` / TS touched.

## Deploy-verify (first prod deploy — Federico-gated, MUST hold before flip-on)

- **Start dark, then flip.** The first prod deploy MUST set `Workers:HrisSyncEnabled=false` until real BambooHR
  creds + `hris_connectors` rows land; only then flip it on. The code default stays `HrisSyncEnabled=true`
  (steady-state intent) so the toggle is a deploy-time off switch, not a default.
- **Single replica until Quartz clusters.** `[DisallowConcurrentExecution]` on `HrisSyncQuartzJob` is
  **process-local** — it prevents overlap only WITHIN one host. The scheduler deployment MUST be pinned to a
  single replica (replica = 1) until the clustered Quartz ADO/Postgres job store lands (deferred below); with
  ≥2 replicas each replica owns its own RAMJobStore and the cron fires **once per replica** (double-fire).
  The recurring-job idempotency key bounds the damage (a double fire dedupes) but the pin is the real control.

## Deferred to later Phase-4 slices (documented, not silent)

- **Persistent + clustered Quartz store (ADO/Postgres) for multi-replica scheduler HA** — only when the
  scheduler needs failover. Introduces `qrtz_*` infra tables → ledger + explicit **RLS-exemption** (scheduler
  state is cross-tenant infra, must NOT get `EnableTenantRls`). Single-replica RAMJobStore is correct now.
- **More recurring jobs** (audit-log retention/purge, FX refresh) — the framework is built to take them.
- **Real alert channel** for `IJobFailureAlerter` (Sentry/Slack) — wired at deploy.
- **`/ready` deep checks** (Redis, connector reachability) as jobs that need them land.
- **Dead-letter for persistent per-record failures** — HRIS already records `hris_sync_record_errors`; a
  cross-job DLQ abstraction lands with the second job that needs it.
