# The FX staleness incident, and the API-hosted refresh that ends it (2026-08-15)

## The incident, reconstructed

Slice 11c designed the FX plane in two halves: reads resolve conversions from DB-pinned `fx_rates`
rows, and a daily `FxRefreshJob` (Quartz, in `Tims.Workers`) keeps the pins fresh.
`PlatformOptions.FxReadsEnabled`'s own docblock records the intended cutover sequence: flip the reads
**after** "the first FxRefreshJob run populates fx_rates".

What actually happened, in order:

1. **2026-07-31** — the one-off `FxSeedOnce` tool pinned USD→{COP, CRC, EUR, MXN}, satisfying the
   SUBSTANCE of that precondition once (fx_rates populated) — though not its letter, which named "the
   first FxRefreshJob run", a run that has still never happened.
2. `Platform__FxReadsEnabled=true` went live (confirmed on the running App Runner service). Of the six
   endpoints behind it, FOUR have no TS fallback at all — `getBandDistribution`, `getTotalCompBreakdown`,
   compensation `getDashboardKpis` (FE-consumed, TS deleted) and `dei.getPayEquity` (TS deleted) — while
   `compensation.getPayEquity` and `simulateAdjustment` keep zero-consumer TS twins
   (`apps/web/lib/platform-api/compensation.ts:27-30` records exactly this split). An earlier version of
   this sentence said all five compensation reads' TS was deleted; the claim auditor counted.
3. **`Tims.Workers` was never deployed.** CI builds its image (`dotnet-platform.yml:92`) but nothing
   runs it. Measured 2026-08-15, not inferred: `aws apprunner list-services --profile tims-ats
   --region us-west-2` returns exactly one service (`tims-platform-api`, account 747814092517), and
   `describe-service` on it shows 26 runtime env vars including `Platform__FxReadsEnabled=true` — and
   **no `Fx__*` keys** (which matters below). "Terraform has never been applied" is the standing record
   from `reference_aws_two_accounts_apprunner` (2026-08-10: only 3 secrets exist, no `base_env` flags),
   not re-measured here.
4. Every production pin therefore still carries `as_of 2026-07-31` and `fetched_at 2026-07-31`.

**Measured impact after fifteen days** (2026-08-15, read-only against production): the pinned COP rate
implies `COP→USD 0.000312438`; live market is `≈0.000320139` — **2.4% drift**, growing with every day
the job doesn't run. The live compensation/pay-equity conversions serve that drift with no fallback.
The same pins feed the (dark) platform-dashboard FX reads, where the divergence was measured at
62.39 USD on `outstandingAmount` — see `phase-5-slice-23-pr3-dashboard-fx.md` §Observed against
production (⚠️ that doc lives on PR **#234**'s branch until it merges; the figures are restated here so
this document stands alone), including why "make C# call Frankfurter live" would be fresher and _less_
accurate.

A second, latent defect compounds it: the refresh's currency discovery
(`FxRateWriteRepository.CurrencyTables`) unioned `employee_compensations`, `salary_bands` and
`companies` — **not `invoices`**, which is what the dashboard FX reads convert. Production's COP
invoices were covered only because compensation tables coincidentally reference COP. The first tenant
invoiced in a currency no compensation row shares would have had no pin: fail-soft suppression on the
live compensation reads, **503** on the dashboard reads (their surface caveat 9).

## The fix

Two changes, both shipped dark:

1. **`invoices` joins the discovery union** (`FxRateWriteRepository.CurrencyTables`), with a
   maintenance rule in the docblock: every table whose `currency` column feeds an `FxMoneyConverter`
   consumer must be listed. `salary_adjustments` is deliberately absent — no FX consumer converts its
   amounts.
2. **`FxRefreshHostedService`** (`Tims.Api/Fx/`): the refresh loop hosted in the **already-deployed**
   API behind `Platform:FxRefreshEnabled` (default false). One run at startup as a catch-up, then one
   every `Fx:RefreshIntervalHours` (default 24). It drives the _same_ `RefreshFxRatesUseCase` the
   Quartz job was built around — the ports-and-adapters boundary that survived the provider swap (one
   actual swap, Frankfurter→ExchangeRate-API, plus the three correction rounds around its rationale)
   unchanged survives a host swap the same way.

Why hosting beats deploying the Workers service _for this problem_: the fix becomes **one env var on
an existing service** instead of a new deployment target (image, service, health checks, IAM,
monitoring) for a single daily HTTP call. The Workers host remains the right home if/when more jobs
need to run; nothing here precludes it. If both ever run, the upsert is
`ON CONFLICT (base_currency, quote_currency, as_of) DO UPDATE`, so racing writers — including
multiple App Runner instances of the API itself — converge on the same row. No leader election is
needed or wanted.

Design decisions worth recording:

- **The catch-all in the loop is load-bearing.** `BackgroundServiceExceptionBehavior` defaults to
  `StopHost`: an escaping exception would take down every live surface of the API over an FX provider
  outage. A failed run logs and waits for the next tick — stale pins beat a dead host, and the reads'
  own dispositions (fail-soft / 503) already own the staleness case. The gateway's Polly pipeline has
  done the short-horizon retrying before an exception ever reaches the loop.
- **The startup run is the operational point.** App Runner boots instances on every deploy and
  scale-out, so "flip the flag" means "pins fresh within seconds of the next boot" — the runbook needs
  no separate catch-up step.
- **Registration is flag-gated (not behaviour-gated)**, mirroring how routes register DI always but
  map behind their flag; `isOpenApiDocGeneration` deliberately does **not** force it on, because that
  escape hatch exists to inventory routes and this maps none.
- **`isOpenApiDocGeneration` untouched, contract untouched** — a hosted service adds no operations;
  verified by Release-build regeneration producing no diff.

## Proofs

| Proof                                                                                                                               | Where                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| discovery sees a currency that exists ONLY on an invoice                                                                            | `FxRefreshHostTests.TheDiscoveryUnion_IncludesInvoices`                                  |
| flag off (default) → service not registered                                                                                         | `FxRefreshHostTests.FlagOff_TheDefault_RegistersNoRefreshService`                        |
| flag on → registered once; startup run pins through the REAL schema (real migration, real unique index; only the egress edge faked) | `FxRefreshHostTests.FlagOn_RegistersOnce_AndTheStartupRunPinsRatesIntoTheRealSchema`     |
| runs at startup, not first-tick                                                                                                     | `FxRefreshHostedServiceTests.Runs_once_at_startup_without_waiting_for_the_first_tick`    |
| provider outage → loop survives to the next tick                                                                                    | `FxRefreshHostedServiceTests.A_provider_failure_is_swallowed_and_the_loop_keeps_ticking` |
| shutdown mid-interval is prompt                                                                                                     | `FxRefreshHostedServiceTests.Shutdown_mid_interval_completes_promptly`                   |

| a provider-side OCE (HttpClient timeout) is not mistaken for shutdown | `FxRefreshHostedServiceTests.A_provider_side_cancellation_is_not_mistaken_for_shutdown` |
| a broken DI graph fails the HOST START (Production env, where ValidateOnBuild is off) | `FxRefreshHostTests.FlagOn_WithABrokenRegistrationGraph_FailsTheHostStart` |
| garbage in tenant currency columns collapses to the fallback and never reaches the gateway | `CurrencyCodesTests` |

Mutation proofs, all run RED: `invoices` dropped from the union; the flag gate inverted (always-on);
the catch-all rethrowing (host death); the startup run becoming delay-first; the StartAsync DI probe
deleted; the OCE `when` clause deleted (a plain catch would let a provider timeout end the loop with the
host alive).

**Detection gap, filed rather than fixed here**: a silent-freeze RECURRENCE (env var lost, provider
permanently failing) still has no tripwire — one log line per tick and nothing watching. Tracked as
**#235** (fx staleness gauge through the AlertMetrics plane).

**Known-unkilled mutations, stated rather than implied covered**: `FromHours`→`FromMinutes` on the
interval (no test waits out a real tick), and the 15-minute failure-retry VALUE (`tickOverrideForTests`
overrides both delays; a clock abstraction for one constant is not worth its weight).

## Runbook — Federico

Two independent options; A gives freshness today with zero code, B makes it permanent.

**Option A — immediate one-off catch-up (no deploy).** Re-run the `FxSeedOnce` tool exactly as on
2026-07-31, per `docs/architecture/csharp-migration/fx-seed-once-runbook.md`. It uses the same
idempotent upsert; a re-run writes today's `as_of` rows and the reads pick them up on their next
query (the provider resolves the latest effective date).

**Option B — permanent (after this PR merges and the API image deploys).**

1. Confirm the deployed image contains this change (App Runner auto-deploys on image push; check the
   service's active image digest date).
2. Add the env var `Platform__FxRefreshEnabled` with value `true` to the `tims-platform-api` App
   Runner service. Use the console env-var editor. Do not use `aws apprunner update-service` with a
   partial map — it drops the other 26 env keys (the documented full-map hazard).
3. The deploy restarts instances; the startup run fires within seconds **when it succeeds**. A failed
   startup run (DB briefly unreachable, provider down) logs
   `fx refresh (api host): run failed` and retries in **15 minutes** — so if step 4's query shows no
   fresh rows, check the App Runner application logs for that line before suspecting the flag. Also a
   precondition, verified clean on 2026-08-15: the service must have **no stray `Fx__*` env vars**
   (`FxOptions` is now bound + validated at startup, so a malformed one — e.g. `Fx__TotalTimeoutSeconds=0`
   — would fail boot even with the refresh flag off). Verify with:

```sql
SELECT quote_currency, rate, as_of, fetched_at FROM fx_rates ORDER BY as_of DESC, quote_currency;
```

4. Fresh rows carry today's `as_of`. Expect a new row set per day thereafter.

**Also worth knowing:**

- The ExchangeRate-API **attribution + subprocessor** bullet in `docs/REMAINING-WORK.md` (line ~704)
  was written as a precondition for the FX flip. The flip has happened (`Platform__FxReadsEnabled=true`
  live); if the FE renders those converted amounts, the attribution obligation is **now due**, not
  future. Not addressed by this PR — it is a product/FE decision.
- This PR and **#234** both add a note near the same anchor of `table-ownership.md`; whichever merges
  second takes a one-line conflict. #234's note says fx_rates has "TWO" writer roots — once BOTH are in
  `main`, that sentence needs "three". Deliberately NOT amended on the #234 branch now (it is CI-green
  and awaiting merge; a doc-only push would reset that): whoever resolves the conflict updates the
  count, and this bullet is the reminder.
