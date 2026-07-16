using System.Collections.Concurrent;
using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Polly.CircuitBreaker;
using Tims.Application.Hris;
using Tims.Infrastructure.Hris;
using Tims.Infrastructure.Hris.BambooHr;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// WP3.2 — drives the REAL Polly-v8 resilience pipeline that <see cref="HrisConnectorServiceCollectionExtensions"/>
/// wires onto the BambooHR typed client, using a stub <see cref="HttpMessageHandler"/> (no live BambooHR
/// call). Proves: transient 429/5xx are retried then succeed; persistent 5xx opens the circuit
/// (<see cref="BrokenCircuitException"/>); the Authorization header carries the Basic-auth built from the
/// secret store; and the plaintext secret never appears in any captured log.
/// </summary>
public sealed class BambooHrConnectorResilienceTests
{
    private const string DirectoryBody =
        """{"employees":[{"id":"1","firstName":"Ada","lastName":"Lovelace","workEmail":"ada@example.com"}]}""";

    private const string SecretRef = "bamboohr/test-api-key";
    private const string SecretValue = "s3cr3t-bamboo-api-key-value";
    private const string Subdomain = "test-subdomain";

    /// <summary>The per-connector auth the sync use case would thread in (its own secret_ref + subdomain).</summary>
    private static readonly HrisConnectorAuthContext Auth = new(SecretRef, Subdomain);

    [Fact]
    public async Task Retries_transient_429_then_500_then_succeeds_on_200()
    {
        using var secretEnv = SetSecretEnv();
        var stub = new StubHttpMessageHandler(
            StubHttpMessageHandler.Sequence(DirectoryBody, HttpStatusCode.TooManyRequests, HttpStatusCode.InternalServerError, HttpStatusCode.OK));

        using var provider = BuildProvider(stub, new Dictionary<string, string?>
        {
            ["Hris:MaxRetryAttempts"] = "3",
            ["Hris:BaseRetryDelayMilliseconds"] = "1",
            // Circuit effectively disabled for this test: it must not open across the 3 samples.
            ["Hris:CircuitMinimumThroughput"] = "100",
        }, out _);

        var connector = provider.GetRequiredService<BambooHrConnector>();

        var page = await connector.FetchDirectoryAsync(Auth, cursor: null, CancellationToken.None);

        // 429 (retry) → 500 (retry) → 200 (success): exactly 3 calls, then a parsed employee.
        Assert.Equal(3, stub.CallCount);
        Assert.Single(page.Employees);
        Assert.Equal("1", page.Employees[0].ExternalId);
        Assert.Null(page.Next);
    }

    [Fact]
    public async Task Persistent_5xx_opens_the_circuit()
    {
        using var secretEnv = SetSecretEnv();
        var stub = new StubHttpMessageHandler(StubHttpMessageHandler.Always(HttpStatusCode.InternalServerError));

        using var provider = BuildProvider(stub, new Dictionary<string, string?>
        {
            ["Hris:MaxRetryAttempts"] = "2",
            ["Hris:BaseRetryDelayMilliseconds"] = "1",
            ["Hris:CircuitMinimumThroughput"] = "2",
            ["Hris:CircuitFailureRatio"] = "1",
            ["Hris:CircuitBreakDurationSeconds"] = "30",
        }, out _);

        var connector = provider.GetRequiredService<BambooHrConnector>();

        BrokenCircuitException? broken = null;
        for (var attempt = 0; attempt < 10 && broken is null; attempt++)
        {
            try
            {
                await connector.FetchDirectoryAsync(Auth, cursor: null, CancellationToken.None);
            }
            catch (BrokenCircuitException ex)
            {
                broken = ex; // the circuit has opened — fast-fail without touching the transport
            }
            catch (HttpRequestException)
            {
                // Circuit still closed: retries exhausted on the persistent 500. Keep driving until it opens.
            }
        }

        Assert.NotNull(broken);
    }

    [Fact]
    public async Task Authorization_header_carries_basic_auth_from_the_secret_store_and_never_leaks_to_logs()
    {
        using var secretEnv = SetSecretEnv();
        var stub = new StubHttpMessageHandler(StubHttpMessageHandler.Sequence(DirectoryBody, HttpStatusCode.OK));

        using var provider = BuildProvider(stub, overrides: new Dictionary<string, string?>(), out var logs);

        var connector = provider.GetRequiredService<BambooHrConnector>();

        await connector.FetchDirectoryAsync(Auth, cursor: null, CancellationToken.None);

        var expected = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{SecretValue}:x"));
        Assert.NotNull(stub.LastAuthorization);
        Assert.Equal("Basic", stub.LastAuthorization!.Scheme);
        Assert.Equal(expected, stub.LastAuthorization.Parameter);

        // Secret hygiene: the plaintext key must appear NOWHERE in captured logs (nor as the header value).
        Assert.All(logs, line => Assert.DoesNotContain(SecretValue, line, StringComparison.Ordinal));
        Assert.DoesNotContain(SecretValue, stub.LastAuthorization.Parameter!, StringComparison.Ordinal);
    }

    /// <summary>
    /// Builds a DI container that wires the real HRIS connector pipeline (AddHrisConnectors) with the
    /// options bound from an in-memory config, then overrides the typed client's primary handler with the
    /// stub. <paramref name="logs"/> captures every log line for the secret-leak assertion.
    /// </summary>
    private static ServiceProvider BuildProvider(
        StubHttpMessageHandler stub,
        Dictionary<string, string?> overrides,
        out ConcurrentQueue<string> logs)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Hris:BambooHrSubdomain"] = "test-subdomain",
            ["Hris:BambooHrSecretRef"] = SecretRef,
            ["Hris:TotalTimeoutSeconds"] = "30",
            ["Hris:MaxRetryAttempts"] = "3",
            ["Hris:BaseRetryDelayMilliseconds"] = "1",
            ["Hris:CircuitMinimumThroughput"] = "10",
            ["Hris:CircuitFailureRatio"] = "0.5",
            ["Hris:CircuitSamplingDurationSeconds"] = "30",
            ["Hris:CircuitBreakDurationSeconds"] = "5",
        };
        foreach (var (key, value) in overrides)
        {
            settings[key] = value;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var captured = new ConcurrentQueue<string>();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Trace);
            logging.AddProvider(new CapturingLoggerProvider(captured));
        });
        services.AddOptions<HrisOptions>()
            .Bind(configuration.GetSection(HrisOptions.SectionName))
            .ValidateDataAnnotations();
        services.AddHrisConnectors();
        // Override the typed client's transport with the stub (same named client → accumulates config).
        services.AddHttpClient<BambooHrConnector>().ConfigurePrimaryHttpMessageHandler(() => stub);

        logs = captured;
        return services.BuildServiceProvider();
    }

    /// <summary>Sets the env var the EnvConnectorSecretStore reads for <see cref="SecretRef"/>, cleared on dispose.</summary>
    private static IDisposable SetSecretEnv()
    {
        var envName = EnvConnectorSecretStore.ToEnvVarName(SecretRef);
        Environment.SetEnvironmentVariable(envName, SecretValue);
        return new EnvVarScope(envName);
    }

    private sealed class EnvVarScope(string name) : IDisposable
    {
        public void Dispose() => Environment.SetEnvironmentVariable(name, null);
    }

    private sealed class CapturingLoggerProvider(ConcurrentQueue<string> sink) : ILoggerProvider
    {
        public ILogger CreateLogger(string categoryName) => new CapturingLogger(sink);

        public void Dispose()
        {
        }

        private sealed class CapturingLogger(ConcurrentQueue<string> sink) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                sink.Enqueue(formatter(state, exception));
                if (exception is not null)
                {
                    sink.Enqueue(exception.ToString());
                }
            }
        }
    }
}
