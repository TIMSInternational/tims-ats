using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using StackExchange.Redis;
using Tims.Api.Configuration;

namespace Tims.Api.HealthChecks;

/// <summary>
/// Readiness probe for Redis. When a connection string is configured it PINGs the server
/// (Unhealthy → /ready 503 if unreachable). When Redis is NOT configured (Phase 1 default)
/// it reports Degraded ("not configured") so /ready stays 200 in local/CI where no Redis
/// exists yet, while still surfacing that the component is absent. Never logs secrets.
/// </summary>
public sealed class RedisHealthCheck(IOptions<PlatformOptions> options) : IHealthCheck
{
    private readonly PlatformOptions _options = options.Value;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var connectionString = _options.RedisConnectionString;
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return HealthCheckResult.Degraded("redis not configured");
        }

        try
        {
            await using var connection = await ConnectionMultiplexer.ConnectAsync(connectionString);
            var latency = await connection.GetDatabase().PingAsync();
            return HealthCheckResult.Healthy($"redis reachable ({latency.TotalMilliseconds:F0}ms)");
        }
        catch (Exception ex) when (ex is RedisConnectionException or RedisTimeoutException or TimeoutException)
        {
            return HealthCheckResult.Unhealthy("redis unreachable", ex);
        }
    }
}
