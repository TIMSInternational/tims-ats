namespace Tims.Application.PlatformHealth;

/// <summary>
/// The five honest states a dependency probe can report. Nothing else may reach the wire:
/// <list type="bullet">
/// <item><see cref="Operational"/> — a live, read-only call to the dependency succeeded just now.</item>
/// <item><see cref="Degraded"/> — the dependency answered, but in a state that impairs it (e.g. SES quota
/// nearly spent, guardrail mid-update).</item>
/// <item><see cref="Down"/> — the dependency did not answer, timed out, or answered that it cannot serve
/// (bucket missing, sending paused, stale worker heartbeat).</item>
/// <item><see cref="NotConfigured"/> — this deployment has no configuration for the dependency, so there is
/// nothing to probe.</item>
/// <item><see cref="NotMonitored"/> — the probe could not establish a state (its own credentials were refused,
/// it faulted, or the dependency is not used/deployed). Never a guess in either direction.</item>
/// </list>
/// </summary>
public static class DependencyStatus
{
    public const string Operational = "operational";
    public const string Degraded = "degraded";
    public const string Down = "down";
    public const string NotConfigured = "not_configured";
    public const string NotMonitored = "not_monitored";
}

/// <summary>
/// Closed set of machine-readable reasons. The wire carries ONLY these codes — never an exception message,
/// hostname, bucket name, guardrail id or HTTP body — so the web app renders localized text from them.
/// </summary>
public static class DependencyReason
{
    public const string Timeout = "timeout";
    public const string Unreachable = "unreachable";
    public const string ErrorStatus = "error_status";
    public const string AccessDenied = "access_denied";
    public const string NotFound = "not_found";
    public const string Misconfigured = "misconfigured";
    public const string MissingConfig = "missing_config";
    public const string SendingPaused = "sending_paused";
    public const string QuotaNearLimit = "quota_near_limit";
    public const string QuotaExhausted = "quota_exhausted";
    public const string GuardrailNotReady = "guardrail_not_ready";
    public const string GuardrailFailed = "guardrail_failed";
    public const string ReadinessFailed = "readiness_failed";
    public const string HeartbeatStale = "heartbeat_stale";
    public const string NotDeployed = "not_deployed";
    public const string NotUsed = "not_used";
    public const string ProbeFailed = "probe_failed";
}

/// <summary>One locale-invariant metric. <c>Value</c> is a plain number or a short closed-set token.</summary>
public sealed record DependencyMetric(string Id, string? Value);

/// <summary>One dependency's probe outcome. <c>LatencyMs</c> is null when no round trip was made.</summary>
public sealed record DependencyProbeResult(
    string Id,
    string Status,
    string? Reason,
    long? LatencyMs,
    IReadOnlyList<DependencyMetric> Metrics)
{
    public static DependencyProbeResult Of(string id, string status, string? reason = null, long? latencyMs = null,
        IReadOnlyList<DependencyMetric>? metrics = null) =>
        new(id, status, reason, latencyMs, metrics ?? []);
}

/// <summary>
/// The response of <c>GET /platform/health/dependencies</c>. <c>CheckedAt</c> is when the probes ran (a cached
/// answer keeps its original instant). <c>AgeMs</c> is how old that measurement is at the moment of THIS
/// response, on the server's own clock: the page anchors it to its local request time, so a cached answer shows
/// its true age without comparing the server clock to the browser clock.
/// </summary>
public sealed record DependencyHealthView(
    DateTimeOffset CheckedAt,
    int CacheSeconds,
    IReadOnlyList<DependencyProbeResult> Dependencies,
    long AgeMs);

/// <summary>Stable dependency ids — identical to the web app's health service ids.</summary>
public static class DependencyIds
{
    public const string Api = "api_gateway";
    public const string Auth = "auth";
    public const string Storage = "storage";
    public const string Jobs = "jobs";
    public const string Ai = "ai";
    public const string Email = "email";
    public const string Realtime = "realtime";

    /// <summary>The wire order. A probe whose id is not listed here is never emitted.</summary>
    public static readonly IReadOnlyList<string> Ordered = [Api, Auth, Storage, Jobs, Ai, Email, Realtime];
}
