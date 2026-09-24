using Microsoft.Extensions.Options;
using Npgsql;
using Tims.Api.Configuration;
using Tims.Application.Proctoring;
using Tims.Infrastructure.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>
/// Denies expired reads in the DB before deleting the S3 objects. A crash
/// between those steps leaves deleted_at null and is retried next sweep.
/// S3 lifecycle remains the separate seven-day backstop.
/// </summary>
public sealed class ProctoringEvidenceRetentionService(
    IServiceScopeFactory scopes, IOptions<PlatformOptions> options,
    ILogger<ProctoringEvidenceRetentionService> logger) : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(5);
    private const long SweepLockKey = 0x54494D5350524F43; // "TIMSPROC"
    private readonly IServiceScopeFactory _scopes = scopes;
    private readonly PlatformOptions _options = options.Value;
    private readonly ILogger<ProctoringEvidenceRetentionService> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_options.ProctoringEvidenceBucketName)
            || string.IsNullOrWhiteSpace(_options.ProctoringEvidenceKmsKeyArn))
            return;

        using var timer = new PeriodicTimer(SweepInterval);
        do
        {
            try { await SweepOnceAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch
            {
                // AWS or DB exception text may contain object keys; never log it.
                _logger.LogError("Proctoring evidence retention sweep failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task SweepOnceAsync(CancellationToken ct)
    {
        // One Postgres session-level advisory lock prevents App Runner replicas
        // from multiplying S3 deletes. A crashed process releases it automatically.
        await using var lockConnection = new NpgsqlConnection(_options.DatabaseConnectionString);
        await lockConnection.OpenAsync(ct);
        await using (var acquire = new NpgsqlCommand(
            "SELECT pg_try_advisory_lock($1)", lockConnection))
        {
            acquire.Parameters.AddWithValue(SweepLockKey);
            if (await acquire.ExecuteScalarAsync(ct) is not true) return;
        }
        try { await SweepLockedAsync(ct); }
        finally
        {
            await using var release = new NpgsqlCommand(
                "SELECT pg_advisory_unlock($1)", lockConnection);
            release.Parameters.AddWithValue(SweepLockKey);
            await release.ExecuteScalarAsync(CancellationToken.None);
        }
    }

    private async Task SweepLockedAsync(CancellationToken ct)
    {
        await using var scope = _scopes.CreateAsyncScope();
        var repository = scope.ServiceProvider
            .GetRequiredService<ProctoringEvidenceRetentionRepository>();
        var store = scope.ServiceProvider.GetRequiredService<IProctoringEvidenceStore>();
        var orgIds = await repository.ListDueOrganizationIdsAsync(10_000, ct);
        var deleted = 0;
        var failed = 0;

        foreach (var organizationId in orgIds)
        {
            var visitedIds = new HashSet<Guid>();
            // 20 bounded batches cover a full 25-candidate cohort (1,750
            // evidence rows) within one sweep without an unbounded DB scan.
            for (var batch = 0; batch < 20; batch++)
            {
                var due = await repository.ExpireDueAsync(
                    organizationId, 100, visitedIds, ct);
                if (due.Count == 0) break;
                foreach (var item in due) visitedIds.Add(item.EvidenceId);
                using var concurrency = new SemaphoreSlim(8);
                var outcomes = await Task.WhenAll(due.Select(async item =>
                {
                    await concurrency.WaitAsync(ct);
                    try
                    {
                        await store.DeleteAsync(item.StagingObjectKey, ct);
                        if (item.SealedObjectKey is { } sealedKey)
                            await store.DeleteAsync(sealedKey, ct);
                        return (Item: item, Succeeded: true);
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch { return (Item: item, Succeeded: false); }
                    finally { concurrency.Release(); }
                }));
                foreach (var outcome in outcomes)
                {
                    if (!outcome.Succeeded) { failed++; continue; }
                    await repository.MarkDeletedAsync(outcome.Item.OrganizationId,
                        outcome.Item.EvidenceId, ct);
                    deleted++;
                }
            }
        }
        if (deleted > 0 || failed > 0)
            _logger.LogInformation(
                "Proctoring evidence retention sweep completed: {Deleted} deleted, {Failed} pending retry",
                deleted, failed);
    }
}
