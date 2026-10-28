using Tims.Infrastructure.CvParsing;

namespace Tims.Api.CvParsing;

/// <summary>
/// Default-off CV recovery loop in the deployed API host. PostgreSQL leases
/// coordinate across API instances. At most two S3/Bedrock calls run per host;
/// failures never stop request serving. No raw CV or provider error is logged.
///
/// Health signals (PII-free, stable tokens for CloudWatch metric filters):
/// <c>CV_RECOVERY_HEARTBEAT</c> on every health tick that completed its backlog
/// query — its ABSENCE (loop stalled, DB unreachable, flag silently off) is
/// alarmed; <c>CV_RECOVERY_ALERT</c> only while something is wrong NOW, so the
/// alert alarm returns to OK once the condition clears.
/// </summary>
public sealed class CvParseRecoveryHostedService(
    CvParseLeaseRepository leases,
    CvParseRecoveryProcessor processor,
    ICvTextExtractor extractor,
    ILogger<CvParseRecoveryHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(30);
    /// <summary>
    /// Health is reported by ELAPSED time, not by loop count: a loop iteration is a whole batch
    /// (fetch, extraction and consent-gated inference, ~65 s worst case) plus the 30 s tick, so
    /// "every 10 iterations" could stretch past the 15-minute heartbeat alarm while the loop was
    /// busy and healthy (tier-1 review). Worst-case spacing is now this interval plus one batch
    /// and one tick, well inside 15 minutes.
    /// </summary>
    public static readonly TimeSpan HealthInterval = TimeSpan.FromMinutes(5);
    public const long OldestDueAlertSeconds = 600;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        DateTime? lastHealth = null;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var batch = await leases.ClaimDueAsync(2, DateTime.UtcNow, stoppingToken).ConfigureAwait(false);
                var outcomes = await Task.WhenAll(batch.Select(lease => RunSafelyAsync(lease, stoppingToken)))
                    .ConfigureAwait(false);
                if (batch.Count > 0)
                {
                    logger.LogInformation("CV recovery batch: claimed {Claimed}, completed {Completed}, failed {Failed}, deferred {Deferred}, ineligible {Ineligible}",
                        batch.Count, outcomes.Count(x => x == CvRecoveryOutcome.Completed),
                        outcomes.Count(x => x == CvRecoveryOutcome.Failed),
                        outcomes.Count(x => x == CvRecoveryOutcome.Deferred),
                        outcomes.Count(x => x == CvRecoveryOutcome.Ineligible));
                }
                // First iteration reports immediately, then once HealthInterval has elapsed.
                var now = DateTime.UtcNow;
                if (IsHealthDue(lastHealth, now))
                {
                    lastHealth = now;
                    var stats = await leases.ReadStatsAsync(DateTime.UtcNow, stoppingToken).ConfigureAwait(false);
                    ReportHealth(logger, stats, extractor.AbandonedExtractions);
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

    /// <summary>True on the first report and whenever <see cref="HealthInterval"/> has elapsed since the last.</summary>
    public static bool IsHealthDue(DateTime? lastHealthUtc, DateTime nowUtc) =>
        lastHealthUtc is not { } last || nowUtc - last >= HealthInterval;

    /// <summary>Returns true when the alert line was emitted.</summary>
    public static bool ReportHealth(ILogger logger, CvRecoveryStats stats, int abandonedExtractions)
    {
        logger.LogInformation("CV_RECOVERY_HEARTBEAT due {Due}, leased {Leased}, deferred {Deferred}, exhausted {Exhausted}, oldest due seconds {OldestDueSeconds}",
            stats.Due, stats.Leased, stats.Deferred, stats.Exhausted, stats.OldestDueAgeSeconds);
        if (stats.ExhaustedRecent == 0 && stats.OldestDueAgeSeconds <= OldestDueAlertSeconds &&
            abandonedExtractions == 0) return false;
        logger.LogWarning("CV_RECOVERY_ALERT: newly exhausted {ExhaustedRecent}, oldest due seconds {OldestDueSeconds}, stuck extractions {Stuck}",
            stats.ExhaustedRecent, stats.OldestDueAgeSeconds, abandonedExtractions);
        return true;
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
