namespace Tims.Api.Proctoring;

/// <summary>
/// Dispatches the DB outbox even after new-session inference is switched off,
/// so already-confirmed work can drain. Errors never take down the API host.
/// </summary>
public sealed class ProctoringInferenceOutboxHostedService(
    IServiceScopeFactory scopeFactory,
    ILogger<ProctoringInferenceOutboxHostedService> logger) : BackgroundService
{
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        _ = scope.ServiceProvider.GetRequiredService<ProctoringInferenceSqsTransport>();
        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<ProctoringInferenceSqsTransport>()
                    .DispatchOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception)
            {
                // No exception text: SDK errors can contain object keys or queue bodies.
                logger.LogWarning("Proctoring inference outbox cycle failed; retrying");
            }
            try { await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }
}

/// <summary>
/// Consumes in-flight results even when CloudInferenceEnabled is turned off.
/// Acknowledges SQS only after a durable repository outcome.
/// </summary>
public sealed class ProctoringInferenceResultHostedService(
    IServiceScopeFactory scopeFactory,
    ILogger<ProctoringInferenceResultHostedService> logger) : BackgroundService
{
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        _ = scope.ServiceProvider.GetRequiredService<ProctoringInferenceSqsTransport>();
        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<ProctoringInferenceSqsTransport>()
                    .ConsumeOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception)
            {
                logger.LogWarning("Proctoring inference result-consumer cycle failed; retrying");
                try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }
}
