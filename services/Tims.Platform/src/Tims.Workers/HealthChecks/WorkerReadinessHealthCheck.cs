using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Tims.Infrastructure.Hris;

namespace Tims.Workers.HealthChecks;

/// <summary>
/// Readiness probe for the scheduler host: the worker needs the platform DB, so <c>/ready</c> pings it
/// cheaply via <see cref="HrisDbContext"/> (<c>CanConnectAsync</c>). Unhealthy (→ /ready 503) when the DB
/// is unreachable. LIVENESS (<c>/health</c>) deliberately runs NO dependency check. Never logs the
/// connection string or any row data.
/// </summary>
public sealed class WorkerReadinessHealthCheck(HrisDbContext dbContext) : IHealthCheck
{
    private readonly HrisDbContext _dbContext = dbContext;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return await _dbContext.Database.CanConnectAsync(cancellationToken).ConfigureAwait(false)
                ? HealthCheckResult.Healthy("postgres reachable")
                : HealthCheckResult.Unhealthy("postgres unreachable");
        }
        catch (Exception ex) when (ex is DbException or InvalidOperationException or TimeoutException)
        {
            // Type + message only — never the connection string.
            return HealthCheckResult.Unhealthy("postgres unreachable", ex);
        }
    }
}
