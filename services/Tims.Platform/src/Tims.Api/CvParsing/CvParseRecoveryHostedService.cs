using Tims.Infrastructure.CvParsing;

namespace Tims.Api.CvParsing;

/// <summary>
/// Default-off CV recovery loop in the deployed API host. PostgreSQL leases
/// coordinate across API instances. At most two S3/Bedrock calls run per host;
/// failures never stop request serving. No raw CV or provider error is logged.
/// </summary>
public sealed class CvParseRecoveryHostedService(
    CvParseLeaseRepository leases,
    CvParseRecoveryProcessor processor,
    ILogger<CvParseRecoveryHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var ticks = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var batch = await leases.ClaimDueAsync(2, DateTime.UtcNow, stoppingToken).ConfigureAwait(false);
                var outcomes = await Task.WhenAll(batch.Select(lease => RunSafelyAsync(lease, stoppingToken)))
                    .ConfigureAwait(false);
                if (batch.Count > 0)
                {
                    logger.LogInformation("CV recovery batch: claimed {Claimed}, completed {Completed}, failed {Failed}, ineligible {Ineligible}",
                        batch.Count, outcomes.Count(x => x == CvRecoveryOutcome.Completed),
                        outcomes.Count(x => x == CvRecoveryOutcome.Failed),
                        outcomes.Count(x => x == CvRecoveryOutcome.Ineligible));
                }
                if (++ticks % 10 == 0)
                {
                    var stats = await leases.ReadStatsAsync(DateTime.UtcNow, stoppingToken).ConfigureAwait(false);
                    logger.LogInformation("CV recovery backlog: due {Due}, leased {Leased}, exhausted {Exhausted}, oldest due seconds {OldestDueSeconds}",
                        stats.Due, stats.Leased, stats.Exhausted, stats.OldestDueAgeSeconds);
                    if (stats.Exhausted > 0 || stats.OldestDueAgeSeconds > 600)
                        logger.LogWarning("CV_RECOVERY_ALERT: exhausted {Exhausted}, oldest due seconds {OldestDueSeconds}",
                            stats.Exhausted, stats.OldestDueAgeSeconds);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception exception)
            {
                // SDK/provider messages can contain the object key or content.
                logger.LogError("CV recovery batch failed ({ErrorType}); retrying", exception.GetType().Name);
            }

            try { await Task.Delay(Tick, stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task<CvRecoveryOutcome> RunSafelyAsync(CvParseLease lease, CancellationToken ct)
    {
        try { return await processor.RunOneAsync(lease, ct).ConfigureAwait(false); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            logger.LogError("CV recovery item failed ({ErrorType}); lease will expire", exception.GetType().Name);
            return CvRecoveryOutcome.Failed;
        }
    }
}
