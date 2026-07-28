# FX Rates One-Off Seed Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a minimal C# console tool (`FxSeedOnce`) that populates `fx_rates` in
production by reusing the existing, already-tested `RefreshFxRatesUseCase` — without deploying the
full `Tims.Workers` host, and without Claude ever touching the production database.

**Architecture:** A new console project under `services/Tims.Platform/tools/FxSeedOnce/` wires
`FxRateDbContext` + `AddFxRateGateway()` + `RefreshFxRatesUseCase` (all pre-existing, unmodified)
via a thin `FxSeedRunner.RunAsync(connectionString, ct)` composition root, invoked once by a
`Program.cs` entrypoint. Verified end-to-end via the existing `FxSchemaFixture` Testcontainers
fixture (real migration, real Frankfurter call) — never against production.

**Tech Stack:** .NET 10, EF Core (Npgsql), xUnit, Testcontainers.PostgreSql.

## Global Constraints

- Claude never connects to, or runs anything against, the production database for this plan. Every
  test and verification step runs against the local Testcontainers-backed Postgres the existing
  `FxSchemaFixture` provisions.
- Do NOT modify `RefreshFxRatesUseCase.cs`, `FxRateWriteRepository.cs`, `FrankfurterFxGateway.cs`,
  `FxRateDbContext.cs`, `FxOptions.cs`, or the `20260723032952_fx_rates` migration — all reused
  exactly as they are.
- Follow this repo's existing C# conventions exactly: `Directory.Build.props` already sets
  `TargetFramework=net10.0`, `Nullable=enable`, `TreatWarningsAsErrors=true`,
  `RestorePackagesWithLockFile=true` for every project under `services/Tims.Platform/` — every new
  `.csproj` still repeats `TargetFramework`/`ImplicitUsings`/`Nullable` explicitly, matching every
  sibling project's own `.csproj` (redundant with `Directory.Build.props` but consistent with house
  style).
- No hardcoded connection strings, keys, or secrets anywhere in committed code — the connection
  string is supplied only at runtime via an argument or environment variable, never logged.

---

### Task 1: FxSeedOnce composition root + integration test

**Files:**

- Create: `services/Tims.Platform/tools/FxSeedOnce/FxSeedOnce.csproj`
- Create: `services/Tims.Platform/tools/FxSeedOnce/FxSeedRunner.cs`
- Modify: `services/Tims.Platform/tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj`
- Create: `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs`

**Interfaces:**

- Produces: `public static class FxSeedOnce.FxSeedRunner { public static Task<int>
RunAsync(string connectionString, CancellationToken cancellationToken); }` — the count returned
  is the number of fx_rates rows pinned (mirrors `RefreshFxRatesUseCase.RunAsync`'s own return
  value, passed through unchanged).

- [ ] **Step 1: Create the project file**

Create `services/Tims.Platform/tools/FxSeedOnce/FxSeedOnce.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- FxSeedOnce: one-off manual tool to populate fx_rates outside the Tims.Workers host, which
       has never been deployed (blocked on BambooHR creds, unrelated timeline — see
       docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md:57-64). Reuses
       RefreshFxRatesUseCase unmodified. See docs/architecture/csharp-migration/fx-seed-once-runbook.md
       for exact run instructions — Federico runs this against prod himself, per the standing
       "I never touch prod" rule; Claude only builds and verifies it locally. -->
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <OutputType>Exe</OutputType>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Tims.Application\Tims.Application.csproj" />
    <ProjectReference Include="..\..\src\Tims.Infrastructure\Tims.Infrastructure.csproj" />
  </ItemGroup>

</Project>
```

This step alone (an empty project with no source files) does not need to build yet — `dotnet`
tolerates a project with zero `.cs` files. Nothing to run here; proceed to Step 2.

- [ ] **Step 2: Wire the test project reference**

In `services/Tims.Platform/tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj`, in the
`ItemGroup` containing the existing `ProjectReference` entries (alongside `Tims.Infrastructure`,
`Tims.Api`, `Tims.Workers`), add:

```xml
    <ProjectReference Include="..\..\tools\FxSeedOnce\FxSeedOnce.csproj" />
```

- [ ] **Step 3: Write the failing test (RED)**

Create `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using FxSeedOnce;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Proves FxSeedRunner's composition root actually works end-to-end: the real fx_rates migration
/// (via FxSchemaFixture), a real call to the public Frankfurter API, and a real upsert into
/// fx_rates. This is the closest proof possible that the tool Federico runs by hand against
/// production will work, without Claude ever touching production itself.
/// </summary>
[Collection(nameof(FxSchemaCollection))]
public sealed class FxSeedRunnerTests(FxSchemaFixture fixture)
{
    private readonly FxSchemaFixture _fixture = fixture;

    [Fact]
    public async Task RunAsync_pins_the_seed_currencies_against_the_real_frankfurter_api()
    {
        await _fixture.ResetAsync();

        var pinned = await FxSeedRunner.RunAsync(_fixture.ConnectionString, CancellationToken.None);

        Assert.True(pinned >= 4, $"expected at least the 4 seed currencies (COP/CRC/EUR/MXN), got {pinned}");

        await using var db = _fixture.NewContext();
        var rows = await db.FxRates.AsNoTracking().ToListAsync();
        Assert.True(rows.Count >= 4);
        Assert.All(rows, row =>
        {
            Assert.Equal("USD", row.BaseCurrency);
            Assert.True(row.Rate > 0 && double.IsFinite(row.Rate));
        });
    }
}
```

- [ ] **Step 4: Run the test to verify it fails for the right reason**

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter FxSeedRunnerTests`
Expected: **build failure** — `error CS0246: The type or namespace name 'FxSeedRunner' could not
be found` (the class doesn't exist yet). This is the expected RED state.

- [ ] **Step 5: Write the composition root (GREEN)**

Create `services/Tims.Platform/tools/FxSeedOnce/FxSeedRunner.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tims.Application.Fx;
using Tims.Infrastructure.Fx;

namespace FxSeedOnce;

/// <summary>
/// One-off composition root for populating fx_rates outside the Tims.Workers host. Wires the exact
/// same DI pieces Tims.Workers/Program.cs registers for the FX plane (FxRateDbContext,
/// AddFxRateGateway, IFxRateWriteRepository, RefreshFxRatesUseCase), minus Quartz scheduling,
/// OpenTelemetry, health checks, and the unrelated HRIS wiring, then invokes
/// RefreshFxRatesUseCase.RunAsync exactly once. FxOptions is registered with no explicit binding —
/// its class-level defaults (frankfurter.dev base URL + standard Polly resilience knobs) are used
/// as-is, identical to what Tims.Workers would use with an empty "Fx" config section.
/// </summary>
public static class FxSeedRunner
{
    public static async Task<int> RunAsync(string connectionString, CancellationToken cancellationToken)
    {
        var services = new ServiceCollection();
        services.AddLogging(builder => builder.AddConsole());
        services.AddOptions<FxOptions>();
        services.AddDbContext<FxRateDbContext>(options => options.UseNpgsql(connectionString));
        services.AddFxRateGateway();
        services.AddScoped<IFxRateWriteRepository, FxRateWriteRepository>();
        services.AddScoped<RefreshFxRatesUseCase>();

        await using var provider = services.BuildServiceProvider();
        var useCase = provider.GetRequiredService<RefreshFxRatesUseCase>();
        return await useCase.RunAsync(cancellationToken).ConfigureAwait(false);
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter FxSeedRunnerTests`
Expected: builds clean, PASS (this spins up a real Testcontainers Postgres and makes a real call
to the public Frankfurter API — allow it a few extra seconds versus a pure-unit test).

- [ ] **Step 7: Run the full Fx test suite to confirm no regressions**

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter Fx`
Expected: `FxRatePinTests`, `FrankfurterFxGatewayResilienceTests`, and the new
`FxSeedRunnerTests` all PASS.

- [ ] **Step 8: Commit**

```bash
git add services/Tims.Platform/tools/FxSeedOnce/FxSeedOnce.csproj \
  services/Tims.Platform/tools/FxSeedOnce/FxSeedRunner.cs \
  services/Tims.Platform/tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj \
  services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs
git commit -m "feat(fx): add FxSeedOnce composition root + integration test"
```

---

### Task 2: Entrypoint, migration script, and handoff runbook

**Files:**

- Create: `services/Tims.Platform/tools/FxSeedOnce/Program.cs`
- Create: `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql` (generated, then reviewed)
- Create: `docs/architecture/csharp-migration/fx-seed-once-runbook.md`

**Interfaces:**

- Consumes: `FxSeedOnce.FxSeedRunner.RunAsync` from Task 1.
- Produces: an executable console app (`dotnet run --project
services/Tims.Platform/tools/FxSeedOnce -- "<DATABASE_URL>"`) that prints
  `"fx-seed-once: pinned N rate(s)."` on success, or `"fx-seed-once: FAILED — <message>"` with a
  non-zero exit code on failure.

- [ ] **Step 1: Write the entrypoint**

Create `services/Tims.Platform/tools/FxSeedOnce/Program.cs`:

```csharp
using FxSeedOnce;

string? connectionString = args.Length > 0 ? args[0] : Environment.GetEnvironmentVariable("FX_SEED_DATABASE_URL");

if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("Usage: dotnet run --project services/Tims.Platform/tools/FxSeedOnce -- \"<DATABASE_URL>\"");
    Console.Error.WriteLine("(or set the FX_SEED_DATABASE_URL environment variable instead of passing an argument)");
    return 1;
}

try
{
    var pinned = await FxSeedRunner.RunAsync(connectionString, CancellationToken.None).ConfigureAwait(false);
    Console.WriteLine($"fx-seed-once: pinned {pinned} rate(s).");
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"fx-seed-once: FAILED — {ex.Message}");
    return 1;
}
```

- [ ] **Step 2: Verify the entrypoint locally against the Testcontainers fixture's own logic (manual smoke run)**

The entrypoint itself has no automated test (it's 15 lines of pure argv/env plumbing around
`FxSeedRunner`, already covered by `FxSeedRunnerTests`), but confirm it actually builds and its
argument handling works:

Run: `dotnet build services/Tims.Platform/tools/FxSeedOnce`
Expected: builds with zero warnings (repo-wide `TreatWarningsAsErrors=true`).

Run: `dotnet run --project services/Tims.Platform/tools/FxSeedOnce` (no argument, no env var set)
Expected: prints the usage message to stderr, exits 1. This proves the missing-argument path
works without needing any database at all.

- [ ] **Step 3: Generate the reviewed migration SQL**

Run (from the repo root):

```bash
dotnet ef migrations script --context FxRateDbContext --idempotent \
  --project services/Tims.Platform/src/Tims.Infrastructure \
  --startup-project services/Tims.Platform/src/Tims.Workers \
  --output services/Tims.Platform/db/manual/20260723032952_fx_rates.sql
```

If this fails because `dotnet ef` cannot resolve a design-time `FxRateDbContext` (it may report
"Unable to create a 'DbContext'"), retry with `--startup-project
services/Tims.Platform/src/Tims.Api` instead (the other host that already wires
`AddDbContext<FxRateDbContext>` for design-time discovery). One of the two hosts will resolve it —
both already register the same `FxRateDbContext` the same way.

Read the generated `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql` back and confirm
it contains: a `CREATE TABLE fx_rates` (or idempotent existence-checked equivalent) with the
columns from `FxRateDbContext.OnModelCreating` (`id`, `base_currency`, `quote_currency`, `rate`,
`as_of`, `fetched_at`, `source`), the unique index `ux_fx_rates_base_quote_asof`, and a
`GRANT SELECT ON fx_rates TO app_tenant` (or equivalent) — matching what
`FxSchemaFixture.InitializeAsync` already proves this migration does in the test suite. If any of
these three elements is missing from the generated script, stop and report DONE_WITH_CONCERNS
rather than handing Federico an incomplete script.

- [ ] **Step 4: Write the handoff runbook**

Create `docs/architecture/csharp-migration/fx-seed-once-runbook.md`:

````markdown
# FX Rates One-Off Seed — Runbook

**Who runs this:** Federico, against production, per the standing "I never touch prod" rule
(`PROD-DEPLOY-RUNBOOK-gate-g3.md:16-19`). Claude built and verified the tool below against a local
Testcontainers Postgres (see `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs`)
but has never connected to or run anything against the production database for this task.

## Why

`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` cannot be flipped until `fx_rates` is populated.
The job that normally populates it (`FxRefreshJob`) only runs inside the `Tims.Workers` App Runner
service, which has never been deployed (blocked on BambooHR creds, unrelated timeline). This tool
reuses the exact same business logic (`RefreshFxRatesUseCase`) to populate `fx_rates` once,
manually, without needing that deploy.

## Steps

1. **Apply the migration.** Review `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql`,
   then apply it directly against prod:

   ```bash
   psql "$PROD_DATABASE_URL" -f services/Tims.Platform/db/manual/20260723032952_fx_rates.sql
   ```

2. **Run the seed tool once**, passing your prod connection string as the single argument (never
   commit or paste this string anywhere):

   ```bash
   dotnet run --project services/Tims.Platform/tools/FxSeedOnce -- "$PROD_DATABASE_URL"
   ```

3. **Confirm success.** The tool prints `fx-seed-once: pinned N rate(s).` — confirm `N > 0`
   (expect at least 4, for the seed currencies COP/CRC/EUR/MXN). A non-zero exit code or a
   `fx-seed-once: FAILED — ...` line means something needs attention before proceeding (most
   likely: the migration in step 1 wasn't actually applied yet).

4. **Optional sanity check** — eyeball the real values:

   ```bash
   psql "$PROD_DATABASE_URL" -c "SELECT base_currency, quote_currency, rate, as_of FROM fx_rates ORDER BY quote_currency;"
   ```

5. **Only after this is confirmed populated**, proceed to flipping
   `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` (separate task/session step).

## Re-running

The underlying upsert is idempotent (`ON CONFLICT (base_currency, quote_currency, as_of) DO
UPDATE`) — safe to re-run this tool any number of times, e.g. periodically to keep rates fresh
until `Tims.Workers` is eventually deployed and takes over on its own Quartz schedule.
````

- [ ] **Step 5: Full local verification**

Run: `dotnet build services/Tims.Platform` (or the solution-wide build command the project
normally uses)
Expected: builds clean, zero warnings.

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter Fx`
Expected: all Fx tests still pass (no regression from adding `Program.cs`).

- [ ] **Step 6: Commit**

```bash
git add services/Tims.Platform/tools/FxSeedOnce/Program.cs \
  services/Tims.Platform/db/manual/20260723032952_fx_rates.sql \
  docs/architecture/csharp-migration/fx-seed-once-runbook.md
git commit -m "feat(fx): add FxSeedOnce entrypoint, reviewed migration SQL, and handoff runbook"
```

---

## Post-plan follow-up (not part of this plan)

- Federico executes the runbook above against production (migration + tool run), on his own
  schedule.
- Once he confirms `fx_rates` is populated, the separate flag-flip task
  (`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`) proceeds — same Vercel env-var + redeploy pattern
  used for every other flag in this migration.
