using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Npgsql;
using Tims.Api.Configuration;

namespace Tims.Api.HealthChecks;

/// <summary>
/// Readiness probe for Postgres: opens a short-lived connection and runs `SELECT 1`.
/// Unhealthy (→ /ready 503) when the DB is unreachable. Never logs the connection string
/// or any row data.
/// </summary>
public sealed class DatabaseHealthCheck(IOptions<PlatformOptions> options) : IHealthCheck
{
    private readonly PlatformOptions _options = options.Value;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await using var connection = new NpgsqlConnection(_options.DatabaseConnectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT 1";
            await command.ExecuteScalarAsync(cancellationToken);
            return HealthCheckResult.Healthy("postgres reachable");
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or InvalidOperationException)
        {
            // Message only (exception type + message) — never the connection string.
            return HealthCheckResult.Unhealthy("postgres unreachable", ex);
        }
    }
}
