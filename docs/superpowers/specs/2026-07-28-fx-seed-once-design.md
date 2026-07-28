# FX Rates One-Off Seed Tool — Design

## Problem

`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` is the last unset `_VIA_CSHARP` flag. Its backend
(`Platform:FxReadsEnabled`) is live-verified, but the three FE-consumed FX-dependent compensation
reads (band distribution, total comp breakdown, dashboard KPIs) depend on the `fx_rates` table
being populated by `FxRefreshJob`. That job only runs inside the `Tims.Workers` App Runner service
(Quartz-scheduled), and that service has never been deployed (blocked on BambooHR creds, unrelated
timeline — see `docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md:57-64`, which
already documents this exact prerequisite: "until Workers deploy, seed `fx_rates` via a one-off
refresh or manual insert before flipping FX").

Flipping the flag today would not crash — the backend fails soft, treating a missing pin as
absent/suppressed data — but any multi-currency org (COP/CRC per the seed set) would silently see
empty or suppressed compensation charts and KPIs. That's a data-correctness regression on live HR
compensation data that nothing would page anyone about.

## Goal

Populate `fx_rates` in production once, without requiring the full `Tims.Workers` deploy, by
reusing the exact same business logic (`RefreshFxRatesUseCase`) that will eventually run on
Workers' own schedule — zero duplicated logic, zero risk of a second implementation drifting from
what ships.

## Execution-ownership constraint (binding)

Per `PROD-DEPLOY-RUNBOOK-gate-g3.md:16-19` ("the standing migration rule — I never touch prod")
and Federico's explicit choice this session: **Claude builds and verifies the tool; Federico
executes the migration SQL and the tool against production himself.** Claude never connects to the
production database or runs anything against it directly for this task.

## Architecture

A new minimal console project, `services/Tims.Platform/tools/FxSeedOnce/`, wires up the existing
`FxRateDbContext` + `AddFxRateGateway()` (Frankfurter HTTP client + Polly resilience, already
implemented and tested) + `RefreshFxRatesUseCase` (already implemented and tested — idempotent
upsert on `(base, quote, as_of)`), and invokes `RunAsync()` exactly once. This is the same DI
composition `Tims.Workers/Program.cs` already performs for the FX plane (lines registering
`FxRateDbContext`/`AddFxRateGateway`/`IFxRateWriteRepository`/`RefreshFxRatesUseCase`), stripped of
Quartz scheduling, OpenTelemetry, health checks, and the unrelated HRIS wiring — a ~10-second boot
instead of a full ASP.NET host.

## Components

- **`FxSeedOnce.csproj`** — console project. References `Tims.Infrastructure` (for
  `FxRateDbContext`, `AddFxRateGateway()`, `FxRateWriteRepository`) and `Tims.Application` (for
  `RefreshFxRatesUseCase`).
- **`FxSeedRunner.cs`** — `public static class FxSeedRunner { public static Task<int>
RunAsync(string connectionString, CancellationToken ct) }`. Builds a `ServiceCollection`,
  registers `AddDbContext<FxRateDbContext>(o => o.UseNpgsql(connectionString))`,
  `AddFxRateGateway()`, `AddScoped<IFxRateWriteRepository, FxRateWriteRepository>()`,
  `AddScoped<RefreshFxRatesUseCase>()`, builds the provider, resolves `RefreshFxRatesUseCase`,
  calls `RunAsync(ct)`, returns the pinned-row count. Kept separate from `Program.cs` specifically
  so an integration test can call it directly against a Testcontainers connection string without
  going through process argv/exit-code plumbing.
- **`Program.cs`** — thin entrypoint. `args[0]` is the connection string (or reads
  `FX_SEED_DATABASE_URL` env var if `args` is empty); missing both → prints a usage message and
  exits 1 without attempting any connection. Calls `FxSeedRunner.RunAsync`, prints
  `"fx-seed-once: pinned {N} rate(s)."`, exits 0. On any exception, prints the exception's message
  (never the connection string) and exits 1.

## Data Flow

1. Federico supplies the real prod `DATABASE_URL` (from AWS Secrets Manager / his own
   `scripts/parity/.env` copy — Claude does not have or need this) as the tool's argument.
2. `FxRateDbContext` connects via Npgsql.
3. The existing Frankfurter gateway fetches latest ECB rates: base `USD`, quotes = the seed set
   (`COP`, `CRC`, `EUR`, `MXN`) unioned with any currency already referenced by existing
   compensation/band/company rows (`ListReferencedCurrenciesAsync`).
4. `RefreshFxRatesUseCase` filters to positive, finite rates.
5. `IFxRateWriteRepository.UpsertRatesAsync` writes rows via the existing idempotent
   `ON CONFLICT (base_currency, quote_currency, as_of) DO UPDATE` — safe to re-run any number of
   times; a same-day re-run updates in place, a new day's run adds new rows.
6. The tool prints the count and exits.

## Error Handling

- Missing connection string → usage message, exit 1, no connection attempt.
- DB error (most likely cause: the `fx_rates` migration hasn't been applied to prod yet, e.g. a
  Postgres "relation does not exist" error) → the real exception message surfaces, uncaught by any
  swallow — Federico sees exactly why and knows to apply the migration first.
- Frankfurter API failure → handled entirely by the existing gateway's Polly resilience layer
  (already covered by `FrankfurterFxGatewayResilienceTests.cs`); whatever it ultimately does
  (retry then fail, or partial results), the tool does not add its own retry/suppression logic on
  top — it surfaces whatever the existing, already-tested gateway contract produces.
- No partial-write risk beyond what the existing repository already guarantees (single
  `UpsertRatesAsync` call over the whole fetched rate set, same as the real job).

## Testing

- **New integration test** in `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/`, reusing
  the existing `FxSchemaFixture` (Testcontainers Postgres with the real `fx_rates` EF migration
  applied — the same fixture `FxRatePinTests.cs` already uses). Calls `FxSeedRunner.RunAsync`
  directly against the fixture's connection string, asserts the returned count is `>= 4` (the seed
  set), and queries `FxRates` directly to confirm real, sane values landed (positive, finite,
  `base_currency == "USD"`). This is a genuine, real network call to the public Frankfurter API —
  intentional, since it is the most faithful proof of the tool's actual wiring, and Frankfurter is
  free/unauthenticated/public (no secrets involved). Accepted as slightly network-flaky in
  isolation, same tradeoff the existing `FxRatePinTests.cs`/`FxSchemaFixture` pattern already
  accepts for this test suite.
- `dotnet test --filter Fx` (or the project's equivalent) run on the whole solution area to
  confirm zero regressions to the existing Fx test suite (`FxRatePinTests.cs`,
  `FrankfurterFxGatewayResilienceTests.cs`, and any `Tims.UnitTests/Fx` tests).
- No production access at any point during testing — everything above runs against the ephemeral
  Testcontainers Postgres.

## Handoff Deliverables (to Federico)

1. The built, tested `FxSeedOnce` tool.
2. The reviewed EF migration SQL, generated locally via
   `dotnet ef migrations script --context FxRateDbContext --idempotent -o fx_rates_migration.sql`
   (pure codegen from migration metadata — no database connection required, so Claude generates
   this directly). Federico reviews the SQL and applies it via `psql` against prod, mirroring the
   established pattern from the access-review domain's hand-applied migration.
3. Exact run instructions:
   a. Apply the migration SQL to prod (Federico, via `psql`).
   b. Run `dotnet run --project services/Tims.Platform/tools/FxSeedOnce -- "<prod DATABASE_URL>"`
   once (Federico).
   c. Confirm the tool's own output: `"fx-seed-once: pinned N rate(s)."` with `N > 0`.
   d. Optional sanity check: `SELECT base_currency, quote_currency, rate, as_of FROM fx_rates
   ORDER BY quote_currency;` via `psql`, to eyeball the actual values.
4. Only after Federico confirms `fx_rates` is populated does the separate flag-flip task
   (`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`) proceed.

## Out of Scope

- Deploying `Tims.Workers` itself (still Federico-only, blocked on BambooHR creds, unrelated to
  this tool).
- Any change to `RefreshFxRatesUseCase`, `FxRateWriteRepository`, or the Frankfurter gateway — all
  reused unmodified.
- The flag flip itself (separate task, gated on Federico confirming this tool's output).
- A recurring/scheduled version of this tool — it's a manual one-off, safely re-runnable by hand
  until Workers actually deploys and takes over on its real schedule.
