# Phase 4 Slice 2 — Clustered / persistent Quartz ADO(Postgres) store for scheduler HA

Date: 2026-07-20 · Status: **In build (agent-driven SDD).** Parent: `phase-4-slice-1-worker-host-scheduler.md` /
`phase-4-workers.md` / `00-master-plan.md`. Branch: `feat/csharp-phase4-slice2-clustered-quartz` off main `e7992a9`.
Deploy-gated (no prod deploy this slice). Closes the Slice-1 deferred follow-up: *"Persistent + clustered Quartz
store (ADO/Postgres) for multi-replica scheduler HA."*

## Objective (toward Gate G4 + SOC 2/ISO availability)

Slice 1 pinned the scheduler to **replica = 1** because a `RAMJobStore` is per-process: with ≥2 replicas each owns
its own in-memory store and a recurring trigger fires **once per replica** (double-fire), and a host crash loses the
schedule until restart. That single replica is a **SPOF** — it blocks a safe multi-replica prod deploy and is the SOC 2
CC7 / ISO 27001 A.5.30 (ICT readiness / availability) gap #8 in [[tims-soc2-iso27001-compliance]].

This slice makes the scheduler **horizontally-available**: a **persistent, clustered Quartz ADO job store on
Postgres** so N worker replicas share one job store and Quartz's cluster election guarantees each recurring trigger
fires **exactly once across the cluster**, with **failover** — if a node dies, the others keep firing its future
triggers (its schedule is not lost, unlike RAMJobStore). It is the prerequisite that lets the first C# prod deploy
run multi-replica — unblocking every dark strangler surface. *(Note: this slice does NOT enable mid-fire
**recovery** — re-running a job whose node crashed WHILE it was executing — which Quartz gates on
`requestsRecovery = true` per job; that is a deferred follow-up below. Failover of future fires ≠ recovery of the
in-flight fire.)*

**What the in-repo tests prove vs. what is inherited (honest scope).** The concurrent, multi-node *fire-exactly-once
election itself cannot be exercised in one test process*: Quartz's `SchedulerRepository` is a process-wide static keyed
by scheduler name, so two live same-named schedulers can't coexist in one process (and two *different*-named ones
wouldn't share the cluster). That election therefore rides on Quartz's own upstream-tested shared-store cluster lock,
enabled here by the standard clustering config set. What OUR config genuinely owns — and what the Testcontainers tests
pin against a real Postgres + the shipped DDL — is: the persistence wiring stands up, the shipped DDL matches what
Quartz expects (`PerformSchemaValidation`), a scheduled job actually fires *through* the Postgres store, a cluster node
registers in `qrtz_scheduler_state` (not RAM), and a **reboot against a populated store doesn't throw or duplicate**.
A genuine concurrent two-*process* election test is a documented follow-up (below).

**Scope discipline (small-PR doctrine):** this slice is *only* the HA store. A second recurring job (audit-purge /
retention) is a **separate later slice** — bundling it here would fight the append-only immutability guards
(CB-1/CB-1b make `data_access_logs`/`audit_logs` DELETE-blocked at the DB level, so a naive purge job is architecturally
wrong and deserves its own design). One vertical concern per PR.

## Load-bearing decisions

1. **Persistent store = the standard Quartz ADO store on Postgres, dark-by-default behind a flag.** New
   `Workers:ClusteredSchedulerEnabled` (default **false**) keeps today's behavior (RAMJobStore, single replica) until
   Federico applies the `qrtz_*` DDL to prod and flips it on — the same "start dark, then flip" deploy discipline as
   every strangled surface. `true` ⇒ `UsePersistentStore` + `UsePostgres` + `UseClustering`. Code default stays false
   so a deploy against a DB **without** the tables can't crash-loop at boot.
2. **Quartz owns the `qrtz_*` schema — NOT Prisma, NOT EF.** These are cross-tenant **infra** tables (scheduler state,
   not tenant data). The DDL is the upstream-canonical Quartz 3.x Postgres schema, pinned in-repo as a single `.sql`
   file that **both** Testcontainers executes **and** Federico applies to prod (one source ⇒ zero drift, like the
   compliance immutability SQL). New ledger category **`quartzInfra`** records them so the table-ownership ledger stays
   the complete source of truth; a governance check asserts they are claimed by **neither** ORM (not `@@map`'d, not
   `.ToTable()`'d).
3. **RLS-EXEMPT by construction.** The `qrtz_*` tables get **no** `EnableTenantRls` — scheduler state is not tenant-
   scoped and carries no `organization_id`. The scheduler connects on the app DB role (`app_tenant`) with plain DML
   grants; no tenant GUC, no row policies. (Contrast: every HRIS/product table is force-RLS.) This is the deliberate,
   documented exemption the Slice-1 doc named.
4. **`UseProperties = true` (no binary/type serialization of job data).** Our jobs carry an **empty** `JobDataMap`
   (everything resolves from the per-fire DI scope), so storing job data as string properties is both sufficient and
   the more secure choice — it avoids the serialized-payload surface entirely. `UseSystemTextJsonSerializer` is still
   registered (Quartz requires a serializer) but never serializes untrusted state.
5. **`SchedulerId = "AUTO"`** so each replica self-assigns a unique cluster instance id (required for clustering). The
   `SchedulerName` is shared across replicas (that's what makes them one cluster).
6. **No behavior change to the jobs.** `HrisSyncQuartzJob` + `ResilientJobRunner` + the DI-scope-per-fire model are
   untouched. `[DisallowConcurrentExecution]` remains (now cluster-wide, not just process-local, because the shared
   store serializes it). The single recurring HRIS trigger still fires on its cron — just once across the cluster.

## Structure outline (files; C-header style)

```
services/Tims.Platform/
  db/quartz/quartz-tables_postgres.sql   → NEW. Upstream-canonical Quartz 3.x Postgres schema (11 qrtz_ tables +
                                            indexes), CREATE-only (no DROP), + GRANT DML to app_tenant, + header
                                            documenting: Quartz-owned, RLS-EXEMPT, single source for prod + tests.
  src/Tims.Workers/
    Tims.Workers.csproj                   → + Quartz.Serialization.SystemTextJson 3.18.2 (pinned; lockfile)
    WorkerOptions.cs                      → + ClusteredSchedulerEnabled (bool, default false)
                                            + SchedulerCheckinIntervalSeconds (Range, default 10)
                                            + SchedulerCheckinMisfireThresholdSeconds (Range, default 20)
                                            + IValidatableObject: threshold > interval when clustered (cross-field)
    Scheduling/QuartzScheduleBuilder.cs   → + ApplyPersistentStore(quartz, options, connString): when
                                            ClusteredSchedulerEnabled, sets SchedulerId=AUTO + UsePersistentStore
                                            (UseProperties, UsePostgres[conn, prefix QRTZ_], UseSystemTextJsonSerializer,
                                            UseClustering[checkin interval/threshold]); else no-op (RAMJobStore).
                                            The single source of persistence config, called by Program AND the test.
    Program.cs                            → AddQuartz(q => { ApplyPersistentStore(q, opts, conn); Configure(q, opts); })
tests/Tims.IntegrationTests/Workers/
    WorkerOptionsValidationTests.cs       → + range-bound cases for the two new checkin knobs + the cross-field
                                            (threshold>interval-when-clustered) bite cases
    QuartzClusterFixture.cs               → NEW. One Postgres container; create app_tenant (grantee of the DDL);
                                            apply db/quartz/quartz-tables_postgres.sql (the SHIPPED file, resolved
                                            from the test output dir). Exposes ConnectionString + row-count helpers.
    QuartzClusterCollection.cs            → NEW. xUnit collection binding the fixture + serializing the clustered
                                            tests (shared process-static SchedulerRepository + ClusteredSchedulerName).
    QuartzClusteredHostTests.cs           → NEW. The proofs (below) — all via WebApplicationFactory<WorkerHostMarker>
                                            (never a raw disposed ServiceProvider, which would poison Quartz's
                                            process-global LogProvider for later boots).
```

## Key invariants (must hold — the tests pin them)

1. **DDL applies cleanly + the schema is what Quartz expects.** The shipped `.sql` runs in one transaction on a fresh
   Postgres (11 tables + indexes + grants). The **real** clustered host boots against it (`PerformSchemaValidation` on
   ⇒ Quartz itself asserts the schema matches; a wrong/absent DDL fails host start).
2. **A scheduled job fires THROUGH the persistent store, and a cluster node registers in Postgres.** On the running
   clustered host, a one-shot job fires (`counter == 1`), and `qrtz_scheduler_state` carries a check-in row — proving
   the ADO cluster store is live, not RAM. **Bite (proven):** flip `ClusteredSchedulerEnabled` off ⇒ the scheduler
   name reverts to the default + `qrtz_scheduler_state` stays empty ⇒ the cluster-node assertions fail.
   *(NOT proven in-repo — deliberately: the concurrent multi-node fire-once election. Two live same-named schedulers
   can't coexist in one process — Quartz's `SchedulerRepository` is a process static — so that election is inherited
   from Quartz's upstream-tested shared-store cluster lock. A genuine two-process test is a deferred follow-up.)*
3. **Reboot against a populated store does not throw or duplicate.** Booting the real host config (`AddJob(StoreDurably)`)
   a second time against the same persistent store must NOT raise `ObjectAlreadyExistsException` (a 200 on the second
   boot proves it) and must leave exactly one `qrtz_job_details` row (replace, not accumulate). The specific
   persistent-store risk the RAM path never exercised.
4. **Default path unchanged.** `ClusteredSchedulerEnabled = false` ⇒ RAMJobStore, no DB dependency at scheduler init
   (the existing `WorkerHostSmokeTests` with a placeholder connection still pass — liveness/registration hold).
5. **RLS-exempt + owned by neither ORM.** `quartzInfra` tables are not in the Prisma `@@map` set and not EF `.ToTable`'d;
   the governance check fails (bite-proven) if either ORM ever claims one. No `EnableTenantRls` anywhere near them.
6. **Cross-field config validation.** With clustering on, `SchedulerCheckinMisfireThresholdSeconds` must exceed
   `SchedulerCheckinIntervalSeconds` (else healthy nodes are falsely reclaimed) — enforced by `IValidatableObject`
   at startup, bite-proven; the rule is inert when clustering is off.

## Regression-corpus gate (STANDING [[tims-csharp-port-regression-corpus]])

This is **greenfield infra** — Quartz clustering has no TS equivalent (the TS app uses Trigger.dev), so there is no
historical TS fix to preserve. The corpus obligation is therefore satisfied by pinning the **new** load-bearing
invariants this slice OWNS — real firing through the persistent store + cluster-node registration (#2, bite-proven),
reboot-idempotency (#3), and the cross-field config guard (#6). The concurrent multi-node election (#2 caveat) is
Quartz-upstream behavior, not our code, so it is inherited rather than re-proven here. No ported-fix catalogue applies.

## Local gate (before PR)

From `services/Tims.Platform`: `dotnet build Tims.Platform.slnx -c Release` (0 warn) · `dotnet format
--verify-no-changes` · `dotnet test tests/Tims.UnitTests/...` · `dotnet test tests/Tims.IntegrationTests/...` (Docker
up). From root: `node scripts/table-ownership.mjs` (+ the governance vitest). No `apps/web` / TS product touched
(only the ledger markdown + the pure `table-ownership.mjs` governance script).

## 🔴 Deploy-verify (Federico-gated; MUST hold before flipping the flag)

- **Apply the DDL first, then flip.** Federico applies `services/Tims.Platform/db/quartz/quartz-tables_postgres.sql`
  to prod (`psql -v ON_ERROR_STOP=1 --single-transaction "<DIRECT_PROD_URL>" -f <file>`) BEFORE setting
  `Workers:ClusteredSchedulerEnabled=true`. Flipping it on against a DB without the tables fails scheduler init.
- **Prefer a DEDICATED scheduler DB role (defense-in-depth).** The DDL grants DML to `app_tenant` for a working
  default, but `app_tenant` is the *same* role tenant-facing RLS queries run as — and `qrtz_*` has no RLS, so a
  tenant-context SQLi/bug could read or tamper with scheduler state (delete triggers, poison locks) with no org
  filter. **Recommended:** point the worker's connection at a dedicated non-tenant scheduler role and `GRANT` the
  `qrtz_*` DML to *that* role instead (revoke from `app_tenant`). Either way, the role the worker actually connects as
  MUST have the DML (these tables have no RLS, so grants are the only gate); the HRIS privileged read already implies
  the worker's role is not plain tenant `app_tenant`, so confirm that role carries the `qrtz_*` grants.
- **Quartz connection vs Supavisor pooling.** Quartz's row-lock semaphore uses `SELECT ... FOR UPDATE` on
  `qrtz_locks` inside short transactions; this is fine under **transaction-mode** pooling, but verify at canary. If
  lock contention/errors appear, point the scheduler's connection string at the session pooler / direct 5432. Ensure
  an adequate `Max Pool Size` on that connection.
- **Then multi-replica.** Only after the above may the scheduler deployment scale past replica = 1. Until the flag is
  on, keep it pinned to 1 (RAMJobStore is process-local).
- **Rollback / flip-back.** To revert: set `Workers:ClusteredSchedulerEnabled=false` (⇒ RAMJobStore) AND
  re-pin the scheduler deployment to **replica = 1** in the same change (leaving it multi-replica on RAM would
  double-fire). The `qrtz_*` tables can be **left in place** — they are inert when the flag is off (nothing reads or
  writes them) — so no DDL rollback is required; drop them only during a deliberate teardown. Flipping back on later
  is a no-op re-apply (the DDL is idempotent) followed by the flag.

## Deferred to later slices (documented, not silent)

- **2nd recurring job (retention/purge)** — its own slice; must reconcile with the CB-1/CB-1b append-only immutability
  (audit tables are DELETE-blocked at the DB, so retention needs an archival-then-permitted-delete design, not a naive
  purge). FX-refresh or a session/token/expired-invitation sweep are cleaner first candidates.
- **Real `IJobFailureAlerter` channel** (Sentry/Slack) — wired at deploy.
- **`requestsRecovery = true`** on the HRIS job (re-fire a job orphaned by a node crash MID-execution — Quartz's
  mid-fire *recovery*, distinct from the future-fire *failover* this slice already gives) — safe because the sweep is
  idempotent; enable when we want crash-recovery semantics, with its own test.
- **Genuine concurrent multi-node exactly-once proof** — needs two separate worker **processes** (or process-isolated
  hosts) against one Postgres, since `SchedulerRepository` is a process static (see the honest-scope note in the
  Objective). Deferred as a heavier/flakier integration test; today the election is inherited from Quartz upstream.
- **Guard the empty-`JobDataMap` invariant** — tenant data must never land in the RLS-exempt, cross-tenant-readable
  `qrtz_*` tables. Today safe (`UseProperties=true` + empty JobDataMap); add a guard/test when the second recurring
  job lands so a future job can't stuff tenant payloads into the store.
