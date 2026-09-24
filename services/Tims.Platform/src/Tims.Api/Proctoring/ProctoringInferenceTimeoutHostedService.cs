using Tims.Application.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>
/// Makes lost inference requests visible to reviewers. Request messages can
/// exhaust Lambda retries and reach a DLQ after the outbox was dispatched;
/// the database needs an independent terminal timeout for that path.
/// </summary>
public sealed class ProctoringInferenceTimeoutHostedService(
    IServiceScopeFactory scopeFactory,
    ILogger<ProctoringInferenceTimeoutHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(SweepInterval);
        do
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var repository = scope.ServiceProvider
                    .GetRequiredService<IProctoringEvidenceRepository>();
                var organizations = await repository
                    .ListStaleDispatchedOutboxOrganizationIdsAsync(100, stoppingToken);
                var marked = 0;
                foreach (var organizationId in organizations)
                    marked += await repository.MarkStaleDispatchedUnavailableAsync(
                        organizationId, 100, stoppingToken);
                if (marked > 0)
                    logger.LogWarning(
                        "Proctoring inference timed out for {Count} evidence items; reviewer cues recorded",
                        marked);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                // Queue payloads and object keys must never enter logs.
                logger.LogWarning("Proctoring inference timeout sweep failed; retrying");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
