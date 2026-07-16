using Tims.Application.Audit;
using Tims.Application.Hris;
using Tims.Domain.Audit;
using Tims.Domain.Hris;
using Tims.Workers.Hris;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// WP3-remediation (Codex Low#2) — the background sweep <see cref="HrisSyncJob"/> must ISOLATE a single
/// connector's failure: one connector throwing (e.g. a fail-closed missing-config before its run even
/// opens) must NOT abort the sweep, so the remaining connectors still process. Fake-based, no DB.
/// </summary>
public sealed class HrisSyncJobTests
{
    private static readonly Guid FailingConnector = Guid.Parse("11111111-0000-0000-0000-0000000000f1");
    private static readonly Guid HealthyConnector = Guid.Parse("22222222-0000-0000-0000-0000000000f2");

    [Fact]
    public async Task One_connectors_failure_does_not_abort_the_sweep()
    {
        // The first connector's LoadSyncConfig THROWS (so RunAsync throws before opening a run); the second
        // resolves cleanly. A pre-fix loop would abort on the first throw and never reach the second.
        var readRepo = new ThrowingThenReachableReadRepository(FailingConnector, HealthyConnector);
        var useCase = new RunHrisSyncUseCase(
            readRepo,
            new UnusedSyncRepository(),
            new UnusedConnectorFactory(),
            new NoOpAuditor(),
            TimeProvider.System);
        var job = new HrisSyncJob(readRepo, useCase, TimeProvider.System);

        await job.RunAsync(CancellationToken.None);

        // The sweep continued past the first connector's throw and reached the second.
        Assert.True(readRepo.FailingConnectorAttempted);
        Assert.True(readRepo.HealthyConnectorReached);
    }

    /// <summary>Lists both connectors; throws for the failing one and returns null (→ skipped) for the healthy one.</summary>
    private sealed class ThrowingThenReachableReadRepository(Guid failing, Guid healthy) : IHrisConnectorReadRepository
    {
        public bool FailingConnectorAttempted { get; private set; }
        public bool HealthyConnectorReached { get; private set; }

        public Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
        {
            IReadOnlyList<Guid> ids = [failing, healthy];
            return Task.FromResult(ids);
        }

        public Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken)
        {
            if (connectorId == failing)
            {
                FailingConnectorAttempted = true;
                throw new InvalidOperationException("simulated per-connector load failure");
            }

            HealthyConnectorReached = true;
            // Null config ⇒ the use case returns Skipped without touching the sync repo/connector.
            return Task.FromResult<HrisConnectorSyncConfig?>(null);
        }
    }

    private sealed class UnusedConnectorFactory : IHrisConnectorFactory
    {
        public IHrisConnector Create(HrisProvider provider) =>
            throw new NotSupportedException("The isolation test never reaches connector creation.");
    }

    private sealed class NoOpAuditor : IDataAccessAuditor
    {
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    /// <summary>Every method throws — the isolation test drives only the config-load path, never persistence.</summary>
    private sealed class UnusedSyncRepository : IHrisSyncRepository
    {
        public Task<HrisSyncRunSnapshot?> FindRunByIdempotencyKeyAsync(
            Guid organizationId, Guid connectorId, string idempotencyKey, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<HrisSyncRunSnapshot> CreatePendingRunAsync(NewHrisSyncRun run, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task MarkRunningAsync(Guid organizationId, Guid runId, DateTime startedAt, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<string, HrisExistingRecordState>> LoadExistingRecordStatesAsync(
            Guid organizationId, Guid connectorId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task PersistRecordsAsync(
            Guid organizationId, Guid connectorId, Guid syncRunId, HrisSyncPersistencePlan plan, DateTime syncedAt, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task FinalizeRunAsync(HrisSyncRunFinalization finalization, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task UpdateConnectorWatermarkAsync(
            Guid organizationId, Guid connectorId, Guid lastSyncRunId, DateTime lastSyncedAt, string? syncCursor, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
