using Microsoft.Extensions.Options;
using Npgsql;
using Tims.Api.Configuration;
using Tims.Infrastructure.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>
/// Removes candidate-authored explanation text after seven days. This runs
/// independently of media capture, including when the S3 feature is disabled.
/// </summary>
public sealed class CandidateExplanationRetentionService(
    IServiceScopeFactory scopes, IOptions<PlatformOptions> options,
    ILogger<CandidateExplanationRetentionService> logger) : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(5);
    private const long SweepLockKey = 0x54494D534558504C; // "TIMSEXPL"
    private readonly IServiceScopeFactory _scopes = scopes;
    private readonly PlatformOptions _options = options.Value;
    private readonly ILogger<CandidateExplanationRetentionService> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_options.DatabaseConnectionString)) return;
        using var timer = new PeriodicTimer(SweepInterval);
        do
        {
            try { await SweepOnceAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch
            {
                // Database exception text may contain sensitive data.
                _logger.LogError("Candidate explanation retention sweep failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task SweepOnceAsync(CancellationToken ct)
    {
        // A session-level advisory lock prevents duplicate work across API replicas.
        await using var connection = new NpgsqlConnection(_options.DatabaseConnectionString);
        await connection.OpenAsync(ct);
        await using (var acquire = new NpgsqlCommand("SELECT pg_try_advisory_lock($1)", connection))
        {
            acquire.Parameters.AddWithValue(SweepLockKey);
            if (await acquire.ExecuteScalarAsync(ct) is not true) return;
        }
        try
        {
            await using var scope = _scopes.CreateAsyncScope();
            var repository = scope.ServiceProvider
                .GetRequiredService<CandidateExplanationRetentionRepository>();
            var orgIds = await repository.ListDueOrganizationIdsAsync(10_000, ct);
            var deleted = 0;
            foreach (var organizationId in orgIds)
            {
                for (var batch = 0; batch < 20; batch++)
                {
                    var count = await repository.DeleteDueAsync(organizationId, 100, ct);
                    deleted += count;
                    if (count < 100) break;
                }
            }
            if (deleted > 0)
                _logger.LogInformation("Expired candidate explanations deleted: {Count}", deleted);
        }
        finally
        {
            await using var release = new NpgsqlCommand("SELECT pg_advisory_unlock($1)", connection);
            release.Parameters.AddWithValue(SweepLockKey);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }
}
