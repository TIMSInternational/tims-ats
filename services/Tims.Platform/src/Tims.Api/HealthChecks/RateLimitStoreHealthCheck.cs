using Microsoft.Extensions.Diagnostics.HealthChecks;
using Tims.Api.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.Api.HealthChecks;

/// <summary>
/// Readiness probe for the shared rate-limit store. When the DynamoDB store is configured it performs one
/// strongly consistent read (Unhealthy → /ready 503 if unreachable or not permitted). When it is NOT
/// configured it reports Degraded ("not configured") so /ready stays 200 in local/CI where no table exists,
/// while still surfacing that the component is absent; outside Development the host refuses to start
/// without it (Program.cs), so this state only exists in Development. The AWS error is deliberately NOT attached: its
/// message can name the account and role ARN.
/// </summary>
public sealed class RateLimitStoreHealthCheck(IServiceProvider services) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var store = services.GetService<DynamoDbRateLimitStore>();
        if (store is null)
        {
            return HealthCheckResult.Degraded("rate-limit store not configured");
        }

        try
        {
            await store.ProbeAsync(cancellationToken).ConfigureAwait(false);
            return HealthCheckResult.Healthy("rate-limit store reachable");
        }
        catch (Exception ex) when (RateLimitGuard.IsStoreUnavailable(ex))
        {
            return HealthCheckResult.Unhealthy($"rate-limit store unreachable ({ex.GetType().Name})");
        }
    }
}
