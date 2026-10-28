using System.Globalization;

namespace Tims.Application.PlatformHealth;

/// <summary>
/// The pure classification rules behind each probe, kept here (not in the SDK-calling probes) so every
/// threshold is unit-testable without AWS, Supabase or Postgres.
/// </summary>
public static class DependencyHealthClassifier
{
    /// <summary>SES quota use at or above this fraction of the 24h cap reports degraded.</summary>
    public const double SesQuotaWarnFraction = 0.8;

    /// <summary>A worker heartbeat older than max(this, 3 × the node's own check-in interval) is stale.</summary>
    public static readonly TimeSpan MinimumHeartbeatStaleness = TimeSpan.FromSeconds(60);

    /// <summary>
    /// SES account state from <c>GetAccountSendingEnabled</c> + <c>GetSendQuota</c>. Sending paused is DOWN
    /// (no email leaves the platform). A max of zero or less carries no usable cap, so no headroom claim is
    /// made from it either way.
    /// </summary>
    public static DependencyProbeResult ClassifySes(bool? sendingEnabled, double? max24HourSend, double? sentLast24Hours, long latencyMs)
    {
        var metrics = new List<DependencyMetric>
        {
            new("sent_last_24h", FormatCount(sentLast24Hours)),
            new("max_24h_send", max24HourSend is > 0 ? FormatCount(max24HourSend) : null),
        };

        if (sendingEnabled is null)
        {
            return DependencyProbeResult.Of(DependencyIds.Email, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed, latencyMs, metrics);
        }

        if (sendingEnabled == false)
        {
            return DependencyProbeResult.Of(DependencyIds.Email, DependencyStatus.Down, DependencyReason.SendingPaused, latencyMs, metrics);
        }

        if (max24HourSend is > 0 && sentLast24Hours is >= 0)
        {
            var used = sentLast24Hours.Value / max24HourSend.Value;
            metrics.Add(new DependencyMetric("quota_used_pct", Math.Round(used * 100, 1).ToString("0.#", CultureInfo.InvariantCulture)));
            if (used >= 1)
            {
                return DependencyProbeResult.Of(DependencyIds.Email, DependencyStatus.Down, DependencyReason.QuotaExhausted, latencyMs, metrics);
            }

            if (used >= SesQuotaWarnFraction)
            {
                return DependencyProbeResult.Of(DependencyIds.Email, DependencyStatus.Degraded, DependencyReason.QuotaNearLimit, latencyMs, metrics);
            }
        }

        return DependencyProbeResult.Of(DependencyIds.Email, DependencyStatus.Operational, null, latencyMs, metrics);
    }

    /// <summary>Bedrock guardrail lifecycle state (from the control-plane <c>GetGuardrail</c>, never an inference).</summary>
    public static DependencyProbeResult ClassifyGuardrail(string? guardrailStatus, long latencyMs)
    {
        var metrics = new List<DependencyMetric> { new("guardrail_status", NormalizeToken(guardrailStatus)) };
        return guardrailStatus?.ToUpperInvariant() switch
        {
            "READY" => DependencyProbeResult.Of(DependencyIds.Ai, DependencyStatus.Operational, null, latencyMs, metrics),
            "CREATING" or "UPDATING" or "VERSIONING" =>
                DependencyProbeResult.Of(DependencyIds.Ai, DependencyStatus.Degraded, DependencyReason.GuardrailNotReady, latencyMs, metrics),
            "FAILED" or "DELETING" =>
                DependencyProbeResult.Of(DependencyIds.Ai, DependencyStatus.Down, DependencyReason.GuardrailFailed, latencyMs, metrics),
            _ => DependencyProbeResult.Of(DependencyIds.Ai, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed, latencyMs, metrics),
        };
    }

    /// <summary>
    /// Supabase Auth <c>/auth/v1/health</c> by HTTP status. 2xx = up; 5xx = down; 401/403 means OUR key was
    /// refused, which says nothing about the service, so it is not_monitored; anything else is degraded.
    /// </summary>
    public static DependencyProbeResult ClassifyAuthHealth(int statusCode, long latencyMs) => statusCode switch
    {
        >= 200 and < 300 => DependencyProbeResult.Of(DependencyIds.Auth, DependencyStatus.Operational, null, latencyMs),
        401 or 403 => DependencyProbeResult.Of(DependencyIds.Auth, DependencyStatus.NotMonitored, DependencyReason.AccessDenied, latencyMs),
        >= 500 => DependencyProbeResult.Of(DependencyIds.Auth, DependencyStatus.Down, DependencyReason.ErrorStatus, latencyMs),
        _ => DependencyProbeResult.Of(DependencyIds.Auth, DependencyStatus.Degraded, DependencyReason.ErrorStatus, latencyMs),
    };

    /// <summary>
    /// S3 <c>HeadBucket</c> failure by HTTP status. 404 = the bucket does not exist (CV upload cannot work:
    /// DOWN). 301/400 = wrong region or malformed name (also cannot work: DOWN, misconfigured). 403 = OUR
    /// credentials were refused — not a statement about the bucket, so not_monitored. 5xx = down.
    /// </summary>
    public static DependencyProbeResult ClassifyBucketError(int statusCode, long latencyMs) => statusCode switch
    {
        404 => DependencyProbeResult.Of(DependencyIds.Storage, DependencyStatus.Down, DependencyReason.NotFound, latencyMs),
        301 or 400 => DependencyProbeResult.Of(DependencyIds.Storage, DependencyStatus.Down, DependencyReason.Misconfigured, latencyMs),
        401 or 403 => DependencyProbeResult.Of(DependencyIds.Storage, DependencyStatus.NotMonitored, DependencyReason.AccessDenied, latencyMs),
        >= 500 => DependencyProbeResult.Of(DependencyIds.Storage, DependencyStatus.Down, DependencyReason.ErrorStatus, latencyMs),
        _ => DependencyProbeResult.Of(DependencyIds.Storage, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed, latencyMs),
    };

    /// <summary>
    /// Tims.Workers' heartbeat, which Quartz writes to <c>qrtz_scheduler_state</c> ONLY in clustered mode.
    /// No table, or a table with no rows, means no worker has ever checked in: reported truthfully as
    /// <c>not_monitored / not_deployed</c>, never as operational. A heartbeat older than
    /// max(60s, 3 × the node's own check-in interval) is DOWN.
    /// </summary>
    public static DependencyProbeResult ClassifyWorkerHeartbeat(
        bool heartbeatStoreExists, int nodeCount, long? lastCheckinEpochMs, long? checkinIntervalMs, DateTimeOffset now, long latencyMs)
    {
        if (!heartbeatStoreExists || nodeCount == 0 || lastCheckinEpochMs is null)
        {
            return DependencyProbeResult.Of(DependencyIds.Jobs, DependencyStatus.NotMonitored, DependencyReason.NotDeployed, latencyMs,
                [new DependencyMetric("worker_nodes", "0")]);
        }

        var age = TimeSpan.FromMilliseconds(Math.Max(0, now.ToUnixTimeMilliseconds() - lastCheckinEpochMs.Value));
        var interval = TimeSpan.FromMilliseconds(Math.Max(0, checkinIntervalMs ?? 0));
        var staleAfter = interval * 3 > MinimumHeartbeatStaleness ? interval * 3 : MinimumHeartbeatStaleness;
        var metrics = new List<DependencyMetric>
        {
            new("worker_nodes", nodeCount.ToString(CultureInfo.InvariantCulture)),
            new("heartbeat_age_s", ((long)age.TotalSeconds).ToString(CultureInfo.InvariantCulture)),
        };

        return age > staleAfter
            ? DependencyProbeResult.Of(DependencyIds.Jobs, DependencyStatus.Down, DependencyReason.HeartbeatStale, latencyMs, metrics)
            : DependencyProbeResult.Of(DependencyIds.Jobs, DependencyStatus.Operational, null, latencyMs, metrics);
    }

    private static string? FormatCount(double? value) =>
        value is >= 0 ? Math.Round(value.Value).ToString("0", CultureInfo.InvariantCulture) : null;

    /// <summary>A short, lowercase, alphanumeric/underscore token — anything else is dropped, never echoed.</summary>
    internal static string? NormalizeToken(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 32 || !value.All(c => char.IsAsciiLetterOrDigit(c) || c == '_'))
        {
            return null;
        }

        return value.ToLowerInvariant();
    }
}
