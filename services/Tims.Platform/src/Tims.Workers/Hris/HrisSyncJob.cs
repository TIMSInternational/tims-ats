using System.Globalization;
using Tims.Application.Hris;

namespace Tims.Workers.Hris;

/// <summary>
/// The thin, invokable entry point for a background HRIS sync (WP3.3). It enumerates every active
/// connector on the privileged owner read and drives <see cref="RunHrisSyncUseCase.RunAsync"/> for each
/// under its own org scope, with a time-bucketed idempotency key so a re-invocation within the same hour
/// short-circuits instead of duplicating work.
///
/// It is NOT a hosted timer: scheduling/cadence (and per-connector <c>sync_cadence</c> binding) is Phase 4.
/// A single connector's failure is isolated so the sweep still processes the rest.
/// </summary>
public sealed class HrisSyncJob(
    IHrisConnectorReadRepository connectorReadRepository,
    RunHrisSyncUseCase runHrisSyncUseCase,
    TimeProvider timeProvider)
{
    private const string ScheduledTrigger = "scheduled";

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var connectorIds = await connectorReadRepository.ListActiveConnectorIdsAsync(cancellationToken);
        var bucket = timeProvider.GetUtcNow().ToString("yyyyMMddHH", CultureInfo.InvariantCulture);

        foreach (var connectorId in connectorIds)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // Hourly bucket ⇒ retry-safe within the window; the use case owns the terminal short-circuit.
            var idempotencyKey = $"{ScheduledTrigger}:{connectorId:N}:{bucket}";
            try
            {
                await runHrisSyncUseCase.RunAsync(connectorId, ScheduledTrigger, idempotencyKey, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                // Cooperative cancellation aborts the WHOLE sweep — never swallowed as a per-connector error.
                throw;
            }
            catch (Exception)
            {
                // Per-connector ISOLATION: one connector's unexpected failure (e.g. a missing-config
                // fail-closed thrown before its run even opened) must NOT abort the sweep. Swallow and
                // continue so the remaining connectors still process. (Phase 4 adds structured logging /
                // metrics + per-connector alerting here.)
            }
        }
    }
}
