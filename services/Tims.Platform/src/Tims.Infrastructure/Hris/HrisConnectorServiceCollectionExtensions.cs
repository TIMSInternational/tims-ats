using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Options;
using Polly;
using Tims.Application.Hris;
using Tims.Infrastructure.Hris.BambooHr;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// Wires the HRIS connector plane (WP3.2): the dev secret store, the provider factory, and the typed
/// BambooHR HttpClient with its Polly-v8 resilience pipeline. Additive — the caller
/// (Program.cs) binds + validates <see cref="HrisOptions"/> first (ValidateOnStart), exactly as it does
/// for PlatformOptions; the same registration is driven from the resilience tests with test options.
/// </summary>
public static class HrisConnectorServiceCollectionExtensions
{
    /// <summary>The resilience-handler name for the BambooHR typed client.</summary>
    public const string BambooHrPipelineName = "hris-bamboohr";

    public static IServiceCollection AddHrisConnectors(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Credentials SEAM: dev/in-memory store now (no real creds); the AWS Secrets Manager impl is
        // deferred to WP3.4 behind the same IConnectorSecretStore port.
        services.AddSingleton<IConnectorSecretStore, EnvConnectorSecretStore>();

        // Typed HttpClient for BambooHR: base address resolved from options; the resilience handler
        // carries total-timeout → retry(exp backoff + jitter, 429/5xx/transient) → circuit breaker.
        services
            .AddHttpClient<BambooHrConnector>((serviceProvider, client) =>
            {
                var options = serviceProvider.GetRequiredService<IOptions<HrisOptions>>().Value;
                client.BaseAddress = new Uri(options.ResolvedBambooHrBaseUrl());
            })
            .AddResilienceHandler(BambooHrPipelineName, (builder, context) =>
            {
                var options = context.GetOptions<HrisOptions>();

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
                // sustained BambooHR outage fails fast (BrokenCircuitException) instead of hammering it.
                builder.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
                {
                    FailureRatio = options.CircuitFailureRatio,
                    MinimumThroughput = options.CircuitMinimumThroughput,
                    SamplingDuration = TimeSpan.FromSeconds(options.CircuitSamplingDurationSeconds),
                    BreakDuration = TimeSpan.FromSeconds(options.CircuitBreakDurationSeconds),
                });
            });

        // Provider factory keyed on HrisProvider (only BambooHr wired).
        services.AddScoped<IHrisConnectorFactory, HrisConnectorFactory>();

        return services;
    }
}
