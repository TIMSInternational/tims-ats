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
