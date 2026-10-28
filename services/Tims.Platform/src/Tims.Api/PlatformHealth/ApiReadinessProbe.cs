using System.Diagnostics;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Tims.Application.PlatformHealth;

namespace Tims.Api.PlatformHealth;

/// <summary>
/// The C# API's own readiness — exactly the checks behind <c>GET /ready</c> (every check tagged <c>ready</c>:
/// Postgres, Redis), run in-process rather than over a loopback HTTP call. Same verdict as <c>/ready</c>:
/// Unhealthy (the endpoint's 503) is DOWN; Healthy or Degraded (its 200 — e.g. Redis not configured) is
/// operational, with each check's own state listed as a metric so a degraded component stays visible.
///
/// <para>If the C# API itself is unreachable this probe never runs; the web app reports that case from the
/// failed request (<c>apps/web/lib/platform-api/platform-health.ts</c>).</para>
/// </summary>
public sealed class ApiReadinessProbe(HealthCheckService healthChecks) : IDependencyProbe
{
    public string Id => DependencyIds.Api;

    public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        var report = await healthChecks
            .CheckHealthAsync(registration => registration.Tags.Contains("ready"), cancellationToken)
            .ConfigureAwait(false);
        var latency = stopwatch.ElapsedMilliseconds;

        // Entry NAMES are fixed registration ids ("postgres", "redis"); descriptions and exceptions are dropped.
        var metrics = report.Entries
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .Select(entry => new DependencyMetric($"ready_{entry.Key}", entry.Value.Status.ToString().ToLowerInvariant()))
            .ToList();

        return report.Status == HealthStatus.Unhealthy
            ? DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.ReadinessFailed, latency, metrics)
            : DependencyProbeResult.Of(Id, DependencyStatus.Operational, null, latency, metrics);
    }
}
