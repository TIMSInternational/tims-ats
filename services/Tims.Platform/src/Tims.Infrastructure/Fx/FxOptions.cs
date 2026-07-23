using System.ComponentModel.DataAnnotations;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// Strongly-typed FX-gateway configuration, bound from the "Fx" section and validated at startup
/// (ValidateDataAnnotations + ValidateOnStart), mirroring <c>HrisOptions</c>. Flat by design. frankfurter is
/// KEYLESS — there is NO secret here (only currency codes egress; register it in the SOC2 subprocessor register).
/// Carries the pinned base URL + the Polly v8 resilience knobs.
/// </summary>
public sealed class FxOptions
{
    public const string SectionName = "Fx";

    /// <summary>The frankfurter (ECB) API base URL. The gateway calls <c>latest?base=…&amp;symbols=…</c>
    /// relative to it. Pinned in config so the ONLY frankfurter surface is auditable.</summary>
    [Required]
    public string FrankfurterBaseUrl { get; init; } = "https://api.frankfurter.dev/v1/";

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
    public string ResolvedFrankfurterBaseUrl() =>
        FrankfurterBaseUrl.EndsWith('/') ? FrankfurterBaseUrl : FrankfurterBaseUrl + "/";
}
