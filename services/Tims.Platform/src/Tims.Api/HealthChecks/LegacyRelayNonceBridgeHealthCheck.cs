using Microsoft.Extensions.Diagnostics.HealthChecks;
using Tims.Api.Http;

namespace Tims.Api.HealthChecks;

/// <summary>
/// Readiness for the rollback-window relay-nonce bridge. While <see cref="LegacyRelayNonceBridge"/> is
/// configured every signed relay request also needs its Redis, so an unreachable Redis is Unhealthy
/// (/ready 503), as it was on the pre-DynamoDB images. Without the bridge there is nothing to check. The
/// exception is not attached: its message can name the Redis host.
/// </summary>
public sealed class LegacyRelayNonceBridgeHealthCheck(IServiceProvider services) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var bridge = services.GetService<LegacyRelayNonceBridge>();
        if (bridge is null)
        {
            return HealthCheckResult.Healthy("relay-nonce bridge off");
        }

        try
        {
            await bridge.PingAsync(cancellationToken).ConfigureAwait(false);
            return HealthCheckResult.Healthy("relay-nonce bridge reachable");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            return HealthCheckResult.Unhealthy($"relay-nonce bridge unreachable ({ex.GetType().Name})");
        }
    }
}
