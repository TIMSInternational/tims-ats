# Phase 4 — C# Workers / Jobs

Date: 2026-07-15 · Status: **Outline; detail at kickoff once the scheduler is chosen.**
Parent: `00-master-plan.md` · Starts after Phase 2; runs parallel to Phase 3 (HRIS needs a worker).

## Objective
Move long-running and scheduled backend work off the serverless request path into a C# worker host — a clear
.NET strength (first-class `IHostedService`, mature schedulers). Establish idempotency, retry, and failure
visibility as reusable infrastructure that Phase 3 (HRIS sync) and Phase 5 domains consume.

## Exit gate G4
- `Tims.Workers` runs **≥1 recurring job** in prod (candidate: FX-rate refresh or audit-log retention/purge).
- Jobs are **idempotent** and **retried** safely; failures are **visible** (alerts + structured logs + OTel).
- Tenant isolation holds inside jobs (jobs that touch org data set the tenant GUC per unit of work, or run on
  the privileged profile ONLY for genuinely cross-org maintenance — explicitly, never accidentally).

## Work packages (to detail at kickoff)
- **WP4.1 Scheduler choice** — decision: in-process (Quartz.NET / Hangfire, simplest, DB-backed) vs
  cloud-native (EventBridge Scheduler + SQS + a Fargate consumer). Default: start in-process (Quartz +
  Postgres store) to avoid new infra; move to cloud-native only if scale/isolation demands it. **This is the
  one decision that unblocks full detail.**
- **WP4.2 Worker host** — `Tims.Workers` container; graceful shutdown; per-job tenant-context handling
  (org-scoped jobs set the GUC; cross-org maintenance jobs are explicitly privileged + audited).
- **WP4.3 Idempotency + retry framework** — idempotency keys, at-least-once with dedupe, exponential backoff,
  dead-letter for persistent failures (mirrors the existing Trigger.dev DLQ/onFailure discipline).
- **WP4.4 First job** — FX refresh or audit purge, end-to-end: scheduled, idempotent, observable, alerting.
- **WP4.5 Observability/alerts** — OTel spans per job run; failure alerts to the existing channel; an ops view
  of job health.

## Job candidates (migrate incrementally after the first)
FX rate refresh · audit log retention/purge · HRIS sync (Phase 3) · billing reconciliation · email/WhatsApp
retry queue · report generation · AI summarization *dispatch* (the inference itself stays in `ai-gateway`) ·
candidate-pipeline automation · data-quality audits.

## Open inputs
- **Scheduler/queue decision** (WP4.1) — the only real blocker to full detail.
- Cloud host (shared with Phase 3) if going cloud-native for scheduling.
