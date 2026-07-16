using System.ComponentModel.DataAnnotations;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// Strongly-typed HRIS connector configuration, bound from the "Hris" section and validated at
/// startup (Program.cs: ValidateDataAnnotations + ValidateOnStart), mirroring
/// <c>PlatformOptions</c>. Flat by design so DataAnnotations validation (which does not recurse into
/// complex members) covers every knob. Carries a secret REFERENCE only — NEVER a credential. Non-secret
/// dev defaults live here / in appsettings; real per-org values arrive with the sync slice + creds work.
/// </summary>
public sealed class HrisOptions
{
    public const string SectionName = "Hris";

    // --- BambooHR provider -------------------------------------------------------------

    /// <summary>
    /// BambooHR API base-URL template. <c>{subdomain}</c> is substituted with
    /// <see cref="BambooHrSubdomain"/> to form the versioned base the connector calls
    /// (<c>employees/directory</c> resolves relative to it).
    /// </summary>
    [Required]
    public string BambooHrBaseUrlTemplate { get; init; } =
        "https://api.bamboohr.com/api/gateway.php/{subdomain}/v1";

    /// <summary>
    /// The BambooHR company subdomain. A dev placeholder now; the real per-org value comes from the
    /// connector row (Slice 3). No live call is made this slice.
    /// </summary>
    [Required]
    public string BambooHrSubdomain { get; init; } = "placeholder-subdomain";

    /// <summary>
    /// The OPAQUE reference the <c>IConnectorSecretStore</c> resolves to the API key — NEVER the key
    /// itself (which lives only in the secret store).
    /// </summary>
    [Required]
    public string BambooHrSecretRef { get; init; } = "bamboohr/api-key";

    /// <summary>Whether the BambooHR connector is enabled (provider-enablement flag).</summary>
    public bool BambooHrEnabled { get; init; } = true;

    // --- Sync safety knobs -------------------------------------------------------------

    /// <summary>
    /// Hard cap on the number of directory pages ONE pull may fetch. A safety net against a paging provider
    /// that never nulls its cursor (which would otherwise loop forever); a legitimate pull stays well under it.
    /// </summary>
    [Range(1, 100000)]
    public int MaxSyncPages { get; init; } = 1000;

    // --- Resilience knobs (Polly v8 pipeline) ------------------------------------------

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

    /// <summary>
    /// Resolves the base URL for a SPECIFIC connector's <paramref name="subdomain"/> (per-connector
    /// isolation), guaranteed to end with '/' for relative fetches. This is the ONLY runtime URL builder
    /// for a real pull — there is no shared/global base URL for an active connector.
    /// </summary>
    public string ResolveBambooHrBaseUrl(string subdomain)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(subdomain);
        var resolved = BambooHrBaseUrlTemplate.Replace("{subdomain}", subdomain, StringComparison.Ordinal);
        return resolved.EndsWith('/') ? resolved : resolved + "/";
    }

    /// <summary>
    /// The base URL with the DEV placeholder <see cref="BambooHrSubdomain"/> resolved. Used ONLY to seed the
    /// typed client's <c>BaseAddress</c> at DI time; a real pull always overrides it with an absolute URI
    /// built from the connector's own subdomain via <see cref="ResolveBambooHrBaseUrl(string)"/>.
    /// </summary>
    public string ResolvedBambooHrBaseUrl() => ResolveBambooHrBaseUrl(BambooHrSubdomain);
}
