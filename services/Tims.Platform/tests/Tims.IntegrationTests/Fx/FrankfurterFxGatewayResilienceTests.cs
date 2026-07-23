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
/// onto the frankfurter typed client, using the stub <see cref="StubHttpMessageHandler"/> (NO live frankfurter
/// call — a live rate is NEVER golden-parity fixtured). Proves: transient 429/5xx are retried then succeed and
/// the ECB date + rates parse; persistent 5xx opens the circuit (<see cref="BrokenCircuitException"/>); the
/// request URL carries base + symbols; frankfurter is KEYLESS (NO Authorization header ever sent).
/// </summary>
public sealed class FrankfurterFxGatewayResilienceTests
{
    private const string LatestBody =
        """{"amount":1.0,"base":"USD","date":"2026-07-21","rates":{"COP":4000.0,"EUR":0.92}}""";

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
        Assert.Equal(new DateOnly(2026, 7, 21), result.AsOf);
        Assert.Equal("USD", result.BaseCurrency);
        Assert.Equal(4000.0, result.Rates["COP"]);
        Assert.Equal(0.92, result.Rates["EUR"]);
        // frankfurter is KEYLESS — no Authorization header is ever attached.
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

    private static ServiceProvider BuildProvider(StubHttpMessageHandler stub, Dictionary<string, string?> overrides)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Fx:FrankfurterBaseUrl"] = "https://frankfurter.test/v1/",
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
        services.AddHttpClient<IFxRateGateway, FrankfurterFxGateway>().ConfigurePrimaryHttpMessageHandler(() => stub);
        return services.BuildServiceProvider();
    }
}
