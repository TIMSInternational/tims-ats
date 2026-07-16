using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Tims.Application.Hris;
using Tims.Workers.Jobs;

namespace Tims.Workers.Hris;

/// <summary>
/// The thin, invokable entry point for a background HRIS sync (WP3.3). It enumerates every active connector
/// on the privileged owner read and drives <see cref="RunHrisSyncUseCase.RunAsync"/> for each under a FRESH
/// DI scope, with an idempotency key bucketed on the SCHEDULED occurrence so a resilient-runner retry of the
/// same fire dedupes while a genuinely later fire does real work.
///
/// PER-CONNECTOR DI ISOLATION (Codex High#1): every connector is served from its own
/// <see cref="IServiceScopeFactory.CreateScope"/>, so each gets its own <c>HrisDbContext</c> (own EF change
/// tracker). A failed save for connector A therefore can NEVER leave A's tracked entities to be flushed
/// under connector B's org GUC (which RLS <c>WITH CHECK</c> would block, cascade-failing the sweep) — the
/// bleed is impossible by construction, not merely caught.
///
/// It is NOT a hosted timer: scheduling/cadence is owned by the Quartz layer, which threads the scheduled
/// fire time in. A single connector's failure is isolated (logged + counted) so the sweep still processes
/// the rest; cooperative cancellation aborts the whole sweep and is never reclassified as a connector error.
/// </summary>
public sealed class HrisSyncJob(IServiceScopeFactory scopeFactory, ILogger<HrisSyncJob> logger)
{
    private const string ScheduledTrigger = "scheduled";

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly ILogger<HrisSyncJob> _logger = logger;

    public async Task RunAsync(DateTimeOffset scheduledFireTime, CancellationToken cancellationToken)
    {
        // Read the active connector ids in their OWN short-lived scope (its DbContext is disposed before the
        // per-connector loop opens, so it never lingers as a shared tracker across the sweep).
        IReadOnlyList<Guid> connectorIds;
        await using (var listScope = _scopeFactory.CreateAsyncScope())
        {
            var connectorReadRepository =
                listScope.ServiceProvider.GetRequiredService<IHrisConnectorReadRepository>();
            connectorIds = await connectorReadRepository.ListActiveConnectorIdsAsync(cancellationToken);
        }

        // The idempotency bucket is the SCHEDULED occurrence (down to the second), NOT wall-clock now: each
        // distinct fire ⇒ distinct key ⇒ real work even on a sub-hourly cadence; a ResilientJobRunner retry
        // of the SAME fire reuses the same occurrence ⇒ same key ⇒ the use case correctly short-circuits.
        var bucket = scheduledFireTime.UtcDateTime.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

        foreach (var connectorId in connectorIds)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var idempotencyKey = $"{ScheduledTrigger}:{connectorId:N}:{bucket}";

            // A FRESH scope per connector ⇒ its own HrisDbContext / change tracker (see the type remarks).
            await using var scope = _scopeFactory.CreateAsyncScope();
            var runHrisSyncUseCase = scope.ServiceProvider.GetRequiredService<RunHrisSyncUseCase>();
            try
            {
                await runHrisSyncUseCase.RunAsync(connectorId, ScheduledTrigger, idempotencyKey, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                // Cooperative cancellation aborts the WHOLE sweep — never swallowed as a per-connector error.
                throw;
            }
            catch (Exception ex)
            {
                // Per-connector ISOLATION: one connector's unexpected failure (e.g. a missing-config
                // fail-closed thrown before its run even opened) must NOT abort the sweep. Log + count it and
                // continue so the remaining connectors still process. The exception + connector id only —
                // never a secret_ref or employee data.
                _logger.LogWarning(ex, "hris sync connector {ConnectorId} failed; continuing sweep", connectorId);
                JobMetrics.ConnectorFailed(HrisSyncQuartzJob.JobName, connectorId);
            }
        }
    }
}
