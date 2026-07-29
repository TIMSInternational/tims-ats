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
/// Frankfurter (ECB) — Frankfurter's v1 endpoint doesn't cover COP/CRC; its v2 API does (including a real
/// batch endpoint), but Frankfurter's own `/v2/currencies` catalog doesn't list COP/CRC even though its
/// rate endpoints serve real data for both, so ExchangeRate-API was kept for its consistent, documented
/// currency coverage.
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
