# FX Rate Provider Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Frankfurter FX-rate adapter with ExchangeRate-API's open/free tier — the
current provider does not support COP or CRC, the actual currencies this platform's real customer
orgs use, so the FX-dependent compensation reads could never work for them regardless of how many
times the refresh job runs.

**Architecture:** `IFxRateGateway` (in `Tims.Application`) is unchanged — only the concrete
`Tims.Infrastructure` adapter, its options, and its DI registration change. Every downstream
consumer (`RefreshFxRatesUseCase`'s orchestration logic, `FxRateWriteRepository`,
`FxRateDbContext`, the `FxSeedOnce` tool) depends only on the interface and needs zero code
changes.

**Tech Stack:** .NET 10, `System.Text.Json`, `Microsoft.Extensions.Http.Resilience` (Polly v8),
xUnit.

## Global Constraints

- `IFxRateGateway`'s public signature does not change.
- `RefreshFxRatesUseCase`'s orchestration logic does not change — only its `Source` string
  literal.
- `FxRateWriteRepository.cs`, `FxRateDbContext.cs`, the `20260723032952_fx_rates` migration, and
  `FxSeedOnce`'s own code (`FxSeedRunner.cs`, `Program.cs`, `FxSeedOnce.csproj`) are NOT modified.
- No new secrets — ExchangeRate-API's open tier is keyless, matching Frankfurter's current
  posture.
- Every test and verification step runs locally (Testcontainers Postgres + real public API calls);
  no production access.

---

### Task 1: Replace the gateway adapter (TDD)

**Files:**

- Delete: `services/Tims.Platform/src/Tims.Infrastructure/Fx/FrankfurterFxGateway.cs`
- Create: `services/Tims.Platform/src/Tims.Infrastructure/Fx/ExchangeRateApiGateway.cs`
- Modify: `services/Tims.Platform/src/Tims.Infrastructure/Fx/FxOptions.cs`
- Modify: `services/Tims.Platform/src/Tims.Infrastructure/Fx/FxServiceCollectionExtensions.cs`
- Modify: `services/Tims.Platform/src/Tims.Application/Fx/RefreshFxRatesUseCase.cs`
- Delete: `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FrankfurterFxGatewayResilienceTests.cs`
- Create: `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/ExchangeRateApiGatewayResilienceTests.cs`

**Interfaces:**

- Consumes: `Tims.Application.Fx.IFxRateGateway`, `Tims.Application.Fx.FxGatewayRates` (both
  unchanged).
- Produces: `public sealed class ExchangeRateApiGateway(HttpClient httpClient) : IFxRateGateway` —
  same public shape `FrankfurterFxGateway` had.

- [ ] **Step 1: Write the failing tests (RED)**

Delete `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FrankfurterFxGatewayResilienceTests.cs`
and create `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/ExchangeRateApiGatewayResilienceTests.cs`:

```csharp
using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Polly.CircuitBreaker;
using Tims.Application.Fx;
using Tims.IntegrationTests.Hris;
using Tims.Infrastructure.Fx;

namespace Tims.IntegrationTests.Fx;

/// <summary>
/// Slice 11c — drives the REAL Polly-v8 resilience pipeline <see cref="FxServiceCollectionExtensions"/> wires
/// onto the ExchangeRate-API typed client, using the stub <see cref="StubHttpMessageHandler"/> (NO live
/// external call — a live rate is NEVER golden-parity fixtured). Proves: transient 429/5xx are retried then
/// succeed and the date + rates parse; persistent 5xx opens the circuit (<see cref="BrokenCircuitException"/>);
/// ExchangeRate-API is KEYLESS (NO Authorization header ever sent); a non-"success" result throws; the gateway
/// filters the response down to only the requested quote currencies (this provider has no server-side symbols
/// filter, unlike the Frankfurter adapter it replaced — see
/// docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md).
/// </summary>
public sealed class ExchangeRateApiGatewayResilienceTests
{
    private const string LatestBody =
        """{"result":"success","base_code":"USD","time_last_update_unix":1785196951,"rates":{"COP":4000.0,"EUR":0.92}}""";

    private static readonly string[] Quotes = { "COP", "EUR" };

    [Fact]
    public async Task Retries_transient_429_then_500_then_succeeds_and_parses_rates()
    {
        var stub = new StubHttpMessageHandler(StubHttpMessageHandler.Sequence(
            LatestBody, HttpStatusCode.TooManyRequests, HttpStatusCode.InternalServerError, HttpStatusCode.OK));

        using var provider = BuildProvider(stub, new Dictionary<string, string?>
        {
            ["Fx:MaxRetryAttempts"] = "3",
            ["Fx:BaseRetryDelayMilliseconds"] = "1",
            ["Fx:CircuitMinimumThroughput"] = "100", // disabled for this test
        });
        var gateway = provider.GetRequiredService<IFxRateGateway>();

        var result = await gateway.FetchLatestAsync("USD", Quotes, CancellationToken.None);

        Assert.Equal(3, stub.CallCount); // 429 → 500 → 200
        Assert.Equal(new DateOnly(2026, 7, 28), result.AsOf); // 1785196951 == 2026-07-28T00:02:31Z
        Assert.Equal("USD", result.BaseCurrency);
        Assert.Equal(4000.0, result.Rates["COP"]);
        Assert.Equal(0.92, result.Rates["EUR"]);
        // ExchangeRate-API is KEYLESS — no Authorization header is ever attached.
        Assert.Null(stub.LastAuthorization);
    }

    [Fact]
    public async Task Persistent_5xx_opens_the_circuit()
    {
        var stub = new StubHttpMessageHandler(StubHttpMessageHandler.Always(HttpStatusCode.InternalServerError));

        using var provider = BuildProvider(stub, new Dictionary<string, string?>
        {
            ["Fx:MaxRetryAttempts"] = "2",
            ["Fx:BaseRetryDelayMilliseconds"] = "1",
            ["Fx:CircuitMinimumThroughput"] = "2",
            ["Fx:CircuitFailureRatio"] = "1",
            ["Fx:CircuitBreakDurationSeconds"] = "30",
        });
        var gateway = provider.GetRequiredService<IFxRateGateway>();

        BrokenCircuitException? broken = null;
        for (var attempt = 0; attempt < 10 && broken is null; attempt++)
        {
            try
            {
                await gateway.FetchLatestAsync("USD", Quotes, CancellationToken.None);
            }
            catch (BrokenCircuitException ex)
            {
                broken = ex; // circuit open — fast-fail without touching the transport
            }
            catch (HttpRequestException)
            {
                // retries exhausted on the persistent 500; keep driving until the circuit opens
            }
        }

        Assert.NotNull(broken);
    }

    [Fact]
    public async Task Filters_the_response_down_to_only_the_requested_quote_currencies()
    {
        // The real API always returns ALL ~166 currencies — this stub mirrors that by including MXN, which
        // was never requested, alongside the two that were (COP, EUR).
        const string bodyWithExtraCurrencies =
            """{"result":"success","base_code":"USD","time_last_update_unix":1785196951,"rates":{"COP":4000.0,"EUR":0.92,"MXN":17.47}}""";
        var stub = new StubHttpMessageHandler(StubHttpMessageHandler.Sequence(bodyWithExtraCurrencies, HttpStatusCode.OK));

        using var provider = BuildProvider(stub, new Dictionary<string, string?>
        {
            ["Fx:CircuitMinimumThroughput"] = "100", // disabled for this test
        });
        var gateway = provider.GetRequiredService<IFxRateGateway>();

        var result = await gateway.FetchLatestAsync("USD", Quotes, CancellationToken.None);

        Assert.Equal(2, result.Rates.Count);
        Assert.True(result.Rates.ContainsKey("COP"));
        Assert.True(result.Rates.ContainsKey("EUR"));
        Assert.False(result.Rates.ContainsKey("MXN"));
    }

    [Fact]
    public async Task A_non_success_result_throws_instead_of_returning_bad_data()
    {
        const string errorBody = """{"result":"error","error-type":"unsupported-code"}""";
        var stub = new StubHttpMessageHandler(StubHttpMessageHandler.Sequence(errorBody, HttpStatusCode.OK));

        using var provider = BuildProvider(stub, new Dictionary<string, string?>
        {
            ["Fx:CircuitMinimumThroughput"] = "100", // disabled for this test
        });
        var gateway = provider.GetRequiredService<IFxRateGateway>();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => gateway.FetchLatestAsync("USD", Quotes, CancellationToken.None));
    }

    private static ServiceProvider BuildProvider(StubHttpMessageHandler stub, Dictionary<string, string?> overrides)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Fx:ExchangeRateApiBaseUrl"] = "https://exchangerate-api.test/",
            ["Fx:TotalTimeoutSeconds"] = "30",
            ["Fx:MaxRetryAttempts"] = "3",
            ["Fx:BaseRetryDelayMilliseconds"] = "1",
            ["Fx:CircuitMinimumThroughput"] = "10",
            ["Fx:CircuitFailureRatio"] = "0.5",
            ["Fx:CircuitSamplingDurationSeconds"] = "30",
            ["Fx:CircuitBreakDurationSeconds"] = "5",
        };
        foreach (var (key, value) in overrides)
        {
            settings[key] = value;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.AddOptions<FxOptions>().Bind(configuration.GetSection(FxOptions.SectionName)).ValidateDataAnnotations();
        services.AddFxRateGateway();
        // Override the typed client's transport with the stub (same named client → accumulates config).
        services.AddHttpClient<IFxRateGateway, ExchangeRateApiGateway>().ConfigurePrimaryHttpMessageHandler(() => stub);
        return services.BuildServiceProvider();
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail to compile (RED)**

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter ExchangeRateApiGatewayResilienceTests`
Expected: build failure — `ExchangeRateApiGateway` and `Fx:ExchangeRateApiBaseUrl`-bound
`FxOptions.ExchangeRateApiBaseUrl`/`ResolvedExchangeRateApiBaseUrl()` don't exist yet.

- [ ] **Step 3: Delete the old gateway, write the new one (GREEN)**

```bash
git rm services/Tims.Platform/src/Tims.Infrastructure/Fx/FrankfurterFxGateway.cs
```

Create `services/Tims.Platform/src/Tims.Infrastructure/Fx/ExchangeRateApiGateway.cs`:

```csharp
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Tims.Application.Fx;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// <see cref="IFxRateGateway"/> for ExchangeRate-API's open/free tier (open.er-api.com), on a TYPED HttpClient
/// whose message pipeline carries the Polly-v8 resilience handler wired in
/// <see cref="FxServiceCollectionExtensions"/> (total timeout → retry+backoff+jitter on 429/5xx → circuit
/// breaker). Keyless — NO Authorization header, NO secret. The ONLY egress is currency codes (no PII).
/// Replaces the original Frankfurter adapter (Slice 11c): Frankfurter's fixed ~30-currency ECB list does not
/// include COP or CRC — the actual currencies this platform's real customer orgs use — so it could never
/// satisfy the FX-dependent compensation reads for them. See
/// docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md.
/// </summary>
public sealed class ExchangeRateApiGateway(HttpClient httpClient) : IFxRateGateway
{
    private readonly HttpClient _httpClient = httpClient;

    public async Task<FxGatewayRates> FetchLatestAsync(
        string baseCurrency, IReadOnlyCollection<string> quoteCurrencies, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseCurrency);
        ArgumentNullException.ThrowIfNull(quoteCurrencies);
        if (quoteCurrencies.Count == 0)
        {
            throw new ArgumentException("At least one quote currency is required.", nameof(quoteCurrencies));
        }

        // v6/latest/USD — base currency is a PATH segment (unlike Frankfurter's ?base= query param), relative
        // to the typed client's pinned BaseAddress. No server-side symbols filter on the open tier — every
        // response carries all ~166 currencies; this gateway filters down to quoteCurrencies below.
        var requestUri = new Uri($"v6/latest/{Uri.EscapeDataString(baseCurrency)}", UriKind.Relative);

        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        // SendAsync runs the typed client's resilience handler; a transient 429/5xx is retried and, on
        // persistent failure, the circuit opens (BrokenCircuitException) — both surface to the caller (the job).
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
        var root = document.RootElement;

        // This API can return HTTP 200 with an app-level error (e.g. an unsupported base currency) — never
        // trust the body without checking "result" first.
        var result = root.TryGetProperty("result", out var resultElement) ? resultElement.GetString() : null;
        if (!string.Equals(result, "success", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"ExchangeRate-API returned result=\"{result ?? "(missing)"}\".");
        }

        var asOf = ParseDate(root);
        var quoteSet = new HashSet<string>(quoteCurrencies, StringComparer.Ordinal);
        var rates = new Dictionary<string, double>(StringComparer.Ordinal);
        if (root.TryGetProperty("rates", out var ratesElement) && ratesElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var pair in ratesElement.EnumerateObject())
            {
                if (quoteSet.Contains(pair.Name)
                    && pair.Value.ValueKind == JsonValueKind.Number
                    && pair.Value.TryGetDouble(out var rate))
                {
                    rates[pair.Name] = rate;
                }
            }
        }

        return new FxGatewayRates(baseCurrency, asOf, rates);
    }

    // time_last_update_unix is Unix epoch seconds (UTC). Absent/unparseable → today's UTC date.
    private static DateOnly ParseDate(JsonElement root) =>
        root.TryGetProperty("time_last_update_unix", out var unixElement)
        && unixElement.ValueKind == JsonValueKind.Number
        && unixElement.TryGetInt64(out var unixSeconds)
            ? DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(unixSeconds).UtcDateTime)
            : DateOnly.FromDateTime(DateTime.UtcNow);
}
```

Note: `CultureInfo` is imported but no longer used directly in this file (the old Frankfurter
adapter used `DateOnly.TryParse(..., CultureInfo.InvariantCulture, ...)` for its string-date
field; this adapter parses a Unix timestamp instead, which needs no culture parameter). Remove the
now-unused `using System.Globalization;` line, or the build fails under
`TreatWarningsAsErrors=true` (`CS8019` unused-using is not itself an error by default, but keep
the import list minimal to match this repo's clean-import convention — verify with `dotnet build`
in Step 6 and delete it if the compiler or analyzer flags it).

- [ ] **Step 4: Update FxOptions**

Replace the full content of `services/Tims.Platform/src/Tims.Infrastructure/Fx/FxOptions.cs` with:

```csharp
using System.ComponentModel.DataAnnotations;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// Strongly-typed FX-gateway configuration, bound from the "Fx" section and validated at startup
/// (ValidateDataAnnotations + ValidateOnStart), mirroring <c>HrisOptions</c>. Flat by design. ExchangeRate-API's
/// open tier is KEYLESS — there is NO secret here (only currency codes egress; register the real provider
/// domain in the SOC2 subprocessor register). Carries the pinned base URL + the Polly v8 resilience knobs.
/// </summary>
public sealed class FxOptions
{
    public const string SectionName = "Fx";

    /// <summary>The ExchangeRate-API (open/free tier) base URL. The gateway calls <c>v6/latest/{base}</c>
    /// relative to it. Pinned in config so the ONLY egress surface is auditable. See
    /// docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md for why this replaced Frankfurter
    /// (ECB) — Frankfurter's fixed currency list does not include COP or CRC.</summary>
    [Required]
    public string ExchangeRateApiBaseUrl { get; init; } = "https://open.er-api.com/";

    // --- Resilience knobs (Polly v8 pipeline) — same shape as HrisOptions ---------------

    /// <summary>Total request timeout across all retries (outermost strategy), in seconds.</summary>
    [Range(1, 600)]
    public int TotalTimeoutSeconds { get; init; } = 30;

    /// <summary>Max retry attempts on transient failure (429 / 5xx / transient network).</summary>
    [Range(0, 10)]
    public int MaxRetryAttempts { get; init; } = 3;

    /// <summary>Base delay for the exponential-with-jitter retry backoff, in milliseconds.</summary>
    [Range(1, 600000)]
    public int BaseRetryDelayMilliseconds { get; init; } = 500;

    /// <summary>Minimum sampled actions before the circuit breaker can open (Polly requires &gt;= 2).</summary>
    [Range(2, 100000)]
    public int CircuitMinimumThroughput { get; init; } = 10;

    /// <summary>Failure ratio (0..1) within the sampling window that opens the circuit.</summary>
    [Range(0.0, 1.0)]
    public double CircuitFailureRatio { get; init; } = 0.5;

    /// <summary>Rolling window over which the failure ratio is measured, in seconds.</summary>
    [Range(1, 3600)]
    public int CircuitSamplingDurationSeconds { get; init; } = 30;

    /// <summary>How long the circuit stays open before probing again, in seconds.</summary>
    [Range(1, 3600)]
    public int CircuitBreakDurationSeconds { get; init; } = 15;

    /// <summary>The base URL guaranteed to end with '/' so relative fetches resolve correctly.</summary>
    public string ResolvedExchangeRateApiBaseUrl() =>
        ExchangeRateApiBaseUrl.EndsWith('/') ? ExchangeRateApiBaseUrl : ExchangeRateApiBaseUrl + "/";
}
```

- [ ] **Step 5: Update FxServiceCollectionExtensions**

Replace the full content of
`services/Tims.Platform/src/Tims.Infrastructure/Fx/FxServiceCollectionExtensions.cs` with:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Options;
using Polly;
using Tims.Application.Fx;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// Wires the FX gateway plane (Slice 11c): the typed ExchangeRate-API HttpClient with its Polly-v8 resilience
/// pipeline (total timeout → retry+backoff+jitter on 429/5xx/transient → circuit breaker) + the
/// <see cref="IFxRateGateway"/> port. Additive — the caller (Program.cs) binds + validates
/// <see cref="FxOptions"/> first (ValidateOnStart), exactly as it does for HrisOptions; the same registration is
/// driven from the resilience tests with test options. ExchangeRate-API's open tier is KEYLESS — no secret store
/// is involved. See docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md for why this replaced
/// Frankfurter (ECB) — Frankfurter's fixed currency list does not include COP or CRC.
/// </summary>
public static class FxServiceCollectionExtensions
{
    /// <summary>The resilience-handler name for the ExchangeRate-API typed client.</summary>
    public const string ExchangeRateApiPipelineName = "fx-exchangerate-api";

    public static IServiceCollection AddFxRateGateway(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services
            .AddHttpClient<IFxRateGateway, ExchangeRateApiGateway>((serviceProvider, client) =>
            {
                var options = serviceProvider.GetRequiredService<IOptions<FxOptions>>().Value;
                client.BaseAddress = new Uri(options.ResolvedExchangeRateApiBaseUrl());
            })
            .AddResilienceHandler(ExchangeRateApiPipelineName, (builder, context) =>
            {
                var options = context.GetOptions<FxOptions>();

                // Outer: a total timeout budget across all retry attempts.
                builder.AddTimeout(TimeSpan.FromSeconds(options.TotalTimeoutSeconds));

                // Middle: retry transient outcomes (429 / 5xx / transient network) with exponential
                // backoff + jitter. The default ShouldHandle is the official HTTP transient predicate.
                builder.AddRetry(new HttpRetryStrategyOptions
                {
                    MaxRetryAttempts = options.MaxRetryAttempts,
                    BackoffType = DelayBackoffType.Exponential,
                    UseJitter = true,
                    Delay = TimeSpan.FromMilliseconds(options.BaseRetryDelayMilliseconds),
                });

                // Inner: break the circuit when transient failures dominate the sampling window, so a
                // sustained provider outage fails fast (BrokenCircuitException) instead of hammering it.
                builder.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
                {
                    FailureRatio = options.CircuitFailureRatio,
                    MinimumThroughput = options.CircuitMinimumThroughput,
                    SamplingDuration = TimeSpan.FromSeconds(options.CircuitSamplingDurationSeconds),
                    BreakDuration = TimeSpan.FromSeconds(options.CircuitBreakDurationSeconds),
                });
            });

        return services;
    }
}
```

- [ ] **Step 6: Update the Source literal**

In `services/Tims.Platform/src/Tims.Application/Fx/RefreshFxRatesUseCase.cs`, change:

```csharp
    private const string Source = "frankfurter";
```

to:

```csharp
    private const string Source = "exchangerate-api";
```

- [ ] **Step 7: Run the tests to verify they pass (GREEN)**

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter ExchangeRateApiGatewayResilienceTests`
Expected: 4/4 PASS (retry-then-succeed, circuit-breaker, filter-to-requested-currencies,
non-success-throws).

- [ ] **Step 8: Run the full Fx suite to confirm no regressions**

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter Fx`
Expected: all Fx tests PASS, including the pre-existing `FxRatePinTests` (untouched) and Task 1's
`FxSeedRunnerTests` (its assertion is still the interim `>= 2` at this point — Task 2 restores it
to `>= 4` once this is merged, since only Task 2 re-runs it live against the real provider to
confirm the fix end-to-end).

- [ ] **Step 9: Commit**

```bash
git add services/Tims.Platform/src/Tims.Infrastructure/Fx/ExchangeRateApiGateway.cs \
  services/Tims.Platform/src/Tims.Infrastructure/Fx/FxOptions.cs \
  services/Tims.Platform/src/Tims.Infrastructure/Fx/FxServiceCollectionExtensions.cs \
  services/Tims.Platform/src/Tims.Application/Fx/RefreshFxRatesUseCase.cs \
  services/Tims.Platform/tests/Tims.IntegrationTests/Fx/ExchangeRateApiGatewayResilienceTests.cs
git add services/Tims.Platform/src/Tims.Infrastructure/Fx/FrankfurterFxGateway.cs \
  services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FrankfurterFxGatewayResilienceTests.cs
git commit -m "feat(fx): replace Frankfurter gateway with ExchangeRate-API (COP/CRC coverage)"
```

---

### Task 2: Doc-comment accuracy pass, live re-verification, and documentation

**Files:**

- Modify: `services/Tims.Platform/src/Tims.Application/Fx/IFxRateGateway.cs`
- Modify: `services/Tims.Platform/src/Tims.Infrastructure/Fx/FxRateEntity.cs`
- Modify: `services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs`
- Modify: `services/Tims.Platform/src/Tims.Workers/Program.cs`
- Modify: `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs`
- Create: `docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md`
- Modify: `docs/architecture/csharp-migration/phase-5-slice-11c-fx-gateway-read.md`
- Modify: `docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md`

**Interfaces:** none new — this task only touches comments, one test assertion, and docs.

- [ ] **Step 1: Update IFxRateGateway.cs doc comments**

In `services/Tims.Platform/src/Tims.Application/Fx/IFxRateGateway.cs`, replace:

```csharp
/// <summary>
/// The outbound port to the external FX-rate provider (frankfurter / ECB, KEYLESS). The ONLY frankfurter
/// surface — implemented by the typed <c>FrankfurterFxGateway</c> (HttpClient + Polly resilience). Used ONLY by
/// the daily refresh job to PIN rates into <c>fx_rates</c>; the FX-derived reads read the pins, never this
/// gateway. Fake-tested with a stub HttpMessageHandler — a live rate is NEVER golden-parity fixtured.
/// </summary>
public interface IFxRateGateway
{
    /// <summary>
    /// Fetch the latest base→quote rates for <paramref name="quoteCurrencies"/> against
    /// <paramref name="baseCurrency"/> (frankfurter <c>latest?base=…&amp;symbols=…</c>). Returns the ECB
    /// effective date + the rates. Transient failures are retried by the Polly pipeline; a persistent failure
    /// throws (the job's ResilientJobRunner records + alerts, then the next tick retries).
    /// </summary>
```

with:

```csharp
/// <summary>
/// The outbound port to the external FX-rate provider (ExchangeRate-API, KEYLESS — see
/// docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md; originally Frankfurter/ECB, replaced
/// because it didn't cover COP/CRC). The ONLY egress surface — implemented by the typed
/// <c>ExchangeRateApiGateway</c> (HttpClient + Polly resilience). Used ONLY by the daily refresh job to PIN
/// rates into <c>fx_rates</c>; the FX-derived reads read the pins, never this gateway. Fake-tested with a stub
/// HttpMessageHandler — a live rate is NEVER golden-parity fixtured.
/// </summary>
public interface IFxRateGateway
{
    /// <summary>
    /// Fetch the latest base→quote rates for <paramref name="quoteCurrencies"/> against
    /// <paramref name="baseCurrency"/>. Returns the provider's effective date + the rates. Transient failures
    /// are retried by the Polly pipeline; a persistent failure throws (the job's ResilientJobRunner records +
    /// alerts, then the next tick retries).
    /// </summary>
```

- [ ] **Step 2: Update FxRateEntity.cs**

In `services/Tims.Platform/src/Tims.Infrastructure/Fx/FxRateEntity.cs`, change:

```csharp
    /// <summary>The ECB effective date the rate is for (frankfurter's <c>date</c>).</summary>
    public DateOnly AsOf { get; set; }

    /// <summary>When the refresh job fetched + pinned this rate (provenance; never a parity input).</summary>
    public DateTime FetchedAt { get; set; }

    /// <summary>The rate source — always <c>frankfurter</c> for now.</summary>
    public string Source { get; set; } = "frankfurter";
```

to:

```csharp
    /// <summary>The provider's effective date the rate is for.</summary>
    public DateOnly AsOf { get; set; }

    /// <summary>When the refresh job fetched + pinned this rate (provenance; never a parity input).</summary>
    public DateTime FetchedAt { get; set; }

    /// <summary>The rate source — always <c>exchangerate-api</c> for now (see
    /// docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md).</summary>
    public string Source { get; set; } = "exchangerate-api";
```

- [ ] **Step 3: Update PlatformOptions.cs comment**

In `services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs`, in the `FxReadsEnabled`
doc comment, change:

```
TS stays the sole active reader until Federico flips it AFTER the first FxRefreshJob run
populates fx_rates at canary).
```

to:

```
TS stays the sole active reader until Federico flips it AFTER the first FxRefreshJob run
populates fx_rates at canary; the upstream FX data provider was swapped from Frankfurter to
ExchangeRate-API 2026-07-28 — see docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md).
```

- [ ] **Step 4: Update Tims.Workers/Program.cs comment**

In `services/Tims.Platform/src/Tims.Workers/Program.cs`, change:

```csharp
    // --- FX gateway plane (Slice 11c): the daily refresh job pins frankfurter (ECB) rates into fx_rates ----
    // The global RLS-exempt FxRateDbContext writes on the PRIVILEGED/owner connection (no TenantScope). The
    // typed frankfurter client + Polly resilience is AddFxRateGateway; the write repo + use case are scoped so
    // Quartz's per-fire DI scope resolves them fresh. AddDbContext is lazy — a placeholder conn never blocks boot.
```

to:

```csharp
    // --- FX gateway plane (Slice 11c): the daily refresh job pins ExchangeRate-API rates into fx_rates ------
    // (originally Frankfurter/ECB; swapped 2026-07-28 — see
    // docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md, Frankfurter never supported COP/CRC).
    // The global RLS-exempt FxRateDbContext writes on the PRIVILEGED/owner connection (no TenantScope). The
    // typed client + Polly resilience is AddFxRateGateway; the write repo + use case are scoped so
    // Quartz's per-fire DI scope resolves them fresh. AddDbContext is lazy — a placeholder conn never blocks boot.
```

- [ ] **Step 5: Restore FxSeedRunnerTests.cs's original assertion and re-verify live**

In `services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs`, change:

```csharp
        Assert.True(pinned >= 2, $"expected at least the 2 Frankfurter-supported seed currencies (EUR/MXN), got {pinned}");

        await using var db = _fixture.NewContext();
        var rows = await db.FxRates.AsNoTracking().ToListAsync();
        Assert.True(rows.Count >= 2);
```

to:

```csharp
        Assert.True(pinned >= 4, $"expected all 4 seed currencies (COP/CRC/EUR/MXN) — the whole reason for the provider swap; got {pinned}");

        await using var db = _fixture.NewContext();
        var rows = await db.FxRates.AsNoTracking().ToListAsync();
        Assert.True(rows.Count >= 4);
```

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter FxSeedRunnerTests`
Expected: PASS, against the REAL live ExchangeRate-API — this is the actual proof that COP/CRC now
populate for real, not just Frankfurter's EUR/MXN.

- [ ] **Step 6: Write the new doc**

Create `docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md`:

```markdown
# FX Rate Provider Swap: Frankfurter → ExchangeRate-API (2026-07-28)

## What happened

While building the `FxSeedOnce` one-off tool to populate `fx_rates` (needed to flip
`NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`), its integration test made the first-ever real call
to the live Frankfurter API with COP and CRC. Frankfurter (ECB) does not support either currency —
confirmed via `curl https://api.frankfurter.dev/v1/currencies`, a fixed list of ~30 major/regional
currencies. Per `RefreshFxRatesUseCase.cs`'s own original comment, COP/CRC are "the live
TIMS/INVU currencies" — the actual currencies this platform's real customer orgs use. No existing
test had ever exercised the real gateway with these currency codes before (existing tests used
synthetic hand-supplied rates).

## What changed

Replaced the `IFxRateGateway` adapter: `FrankfurterFxGateway` → `ExchangeRateApiGateway`, backed by
ExchangeRate-API's open/free tier (`open.er-api.com`) — confirmed via live API call to cover both
COP and CRC, plus 166 currencies total. Same posture as Frankfurter: keyless, free, commercial use
permitted. Only the concrete adapter, `FxOptions`, and the DI registration changed —
`RefreshFxRatesUseCase`'s orchestration logic, `FxRateWriteRepository`, `FxRateDbContext`, the
migration, and the `FxSeedOnce` tool were all untouched (they depend only on the `IFxRateGateway`
interface).

## Why this provider

See the comparison table in `docs/superpowers/specs/2026-07-28-fx-provider-swap-design.md`. In
short: Open Exchange Rates also covers COP/CRC but requires a paid plan + API key (new secret, new
recurring cost); exchangerate.host no longer has a free/keyless tier; official central bank APIs
are the most authoritative for these two specific currencies but would require two separate
country-specific integrations plus a second source for other currencies. ExchangeRate-API's open
tier solves the actual problem with the least disruption to the existing keyless, free setup.

## Verification

- New/updated resilience tests: `ExchangeRateApiGatewayResilienceTests.cs` (stub-based, no live
  call — retry/circuit-breaker/filtering/error-handling).
- Live re-verification: `FxSeedRunnerTests.cs`'s assertion restored to `>= 4` and re-run against
  the real API — all 4 seed currencies (COP/CRC/EUR/MXN) now populate for real.
```

- [ ] **Step 7: Add pointer notes to the two historical docs**

In `docs/architecture/csharp-migration/phase-5-slice-11c-fx-gateway-read.md`, immediately after
line 6 (`**Depends on:** compensation FX-free (#162) + DEI (11b) merged. Branch off main after
11b.`) and before the `## The gateway` header, insert a new line:

```markdown
**UPDATE 2026-07-28: FX PROVIDER SWAPPED.** Frankfurter's fixed ~30-currency ECB list does not
include COP or CRC — the actual currencies this platform's real customer orgs use — discovered via
the first-ever live COP/CRC API call (the `FxSeedOnce` tool's integration test). Replaced with
ExchangeRate-API's open/free tier (still keyless, still free) — see
`docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md`. Every mention of
"frankfurter"/"ECB" below is historical (describes what shipped originally, not the current
provider); the table/job/gateway design itself is unaffected.
```

In `docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md`, in the same blockquote
that already contains the `**UPDATE 2026-07-27:**` sentence (the blockquote starting `> **What
changed since 2026-07-21.**`), append a new sentence at the end of that blockquote:

```markdown
**UPDATE 2026-07-28:** the FX rate provider was swapped from Frankfurter to ExchangeRate-API
(`open.er-api.com`) — Frankfurter never supported COP/CRC, the actual currencies real customer orgs
use. See `docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md`. The `fx_rates`
migration/table/job design in §1/§8 is unaffected — only the upstream data source changed.
```

- [ ] **Step 8: Full verification + grep sweep**

Run: `dotnet build services/Tims.Platform/Tims.Platform.slnx`
Expected: 0 warnings, 0 errors.

Run: `dotnet test services/Tims.Platform/tests/Tims.IntegrationTests --filter Fx`
Expected: all Fx tests PASS.

Run: `grep -rin "frankfurter" services/Tims.Platform --include="*.cs" | grep -v obj | grep -v bin`
Expected: **zero matches** in any `.cs` file (all functional/comment references updated). Any
remaining matches in `docs/audits/`, `docs/architecture/table-ownership.md`, or the two historical
slice/runbook docs beyond the pointer notes just added are acceptable (historical record, not
rewritten) — but confirm nothing in `services/` itself still says "frankfurter".

- [ ] **Step 9: Commit**

```bash
git add services/Tims.Platform/src/Tims.Application/Fx/IFxRateGateway.cs \
  services/Tims.Platform/src/Tims.Infrastructure/Fx/FxRateEntity.cs \
  services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs \
  services/Tims.Platform/src/Tims.Workers/Program.cs \
  services/Tims.Platform/tests/Tims.IntegrationTests/Fx/FxSeedRunnerTests.cs \
  docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md \
  docs/architecture/csharp-migration/phase-5-slice-11c-fx-gateway-read.md \
  docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md
git commit -m "docs(fx): doc-comment accuracy pass + live re-verification for the provider swap"
```

---

## Post-plan follow-up (not part of this plan)

- Resume the original `FxSeedOnce` Task 2 (entrypoint, reviewed migration SQL, handoff runbook) —
  now against the corrected provider. The runbook doc should mention the provider swap so Federico
  knows why the tool's expected output changed from "2 rates" to "4 rates".
- Registering the new subprocessor (ExchangeRate-API / exchangerate-api.com) in an actual external
  SOC2/compliance tracking system is an org-level action for Federico — no in-repo file exists for
  this (confirmed via grep).
